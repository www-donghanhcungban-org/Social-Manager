import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAiGateway, MAX_PROMPT_BYTES } from "@/src/ai/gateway";
import {
  AiDisabledError,
  AiNotAllowedError,
  ModelError,
  type ModelPort,
} from "@/src/ai/port";
import { ForbiddenError } from "@/src/auth/errors";
import { aiDisclosures, members, workspaces } from "@/src/db/schema";
import { ValidationError } from "@/src/providers/types";
import { createWorkspaceService } from "@/src/workspaces/service";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
const calls: { system: string; user: string }[] = [];

const model = (over: Partial<ModelPort> = {}): ModelPort => ({
  id: "fake",
  model: "m1",
  local: true,
  host: "localhost:11434",
  generate: async (req) => {
    calls.push({ system: req.system, user: req.user });
    return { text: "trả lời" };
  },
  ...over,
});
const gw = (m: ModelPort | null) => createAiGateway({ db: t.db, model: m });
const ask = (m: ModelPort | null, over: Record<string, unknown> = {}) =>
  gw(m).complete({
    actorId: "member",
    workspaceId: ws,
    purpose: "answer",
    system: "SYS",
    user: "câu hỏi và trích đoạn",
    itemCount: 2,
    ...over,
  });
const rows = () => t.db.select().from(aiDisclosures);

beforeEach(async () => {
  t = await createTestDb();
  calls.length = 0;
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  ws = w!.id;
  await t.db.insert(members).values([
    { workspaceId: ws, userId: "owner", role: "owner" },
    { workspaceId: ws, userId: "admin", role: "admin" },
    { workspaceId: ws, userId: "member", role: "member" },
  ]);
});
afterEach(async () => {
  await t.client.close();
});

describe("cổng AI", () => {
  it("AI tắt (không có mô hình): AiDisabledError, không gọi gì, không ghi nhật ký", async () => {
    expect(gw(null).enabled).toBe(false);
    await expect(ask(null)).rejects.toBeInstanceOf(AiDisabledError);
    expect(await rows()).toEqual([]);
  });

  it("điểm cuối cục bộ: gọi được không cần cờ; nhật ký ghi số mục, số byte, điểm cuối — không có nội dung", async () => {
    const r = await ask(model());
    expect(r.text).toBe("trả lời");
    const [d] = await rows();
    expect(d).toMatchObject({
      workspaceId: ws,
      actorId: "member",
      purpose: "answer",
      endpointHost: "localhost:11434",
      model: "m1",
      local: true,
      itemCount: 2,
      bytesSent:
        Buffer.byteLength("SYS") + Buffer.byteLength("câu hỏi và trích đoạn"),
      status: "ok",
      errorCode: null,
    });
    expect(d!.id).toBe(r.disclosureId);
    expect(JSON.stringify(d)).not.toMatch(/câu hỏi|trích đoạn|trả lời|SYS/);
  });

  it("đám mây khi workspace chưa bật: bị chặn, KHÔNG gửi, ghi blocked với 0 byte", async () => {
    const cloud = model({ local: false, host: "api.example.com" });
    await expect(ask(cloud)).rejects.toBeInstanceOf(AiNotAllowedError);
    expect(calls).toEqual([]);
    const [d] = await rows();
    expect(d).toMatchObject({
      status: "blocked",
      bytesSent: 0,
      local: false,
      endpointHost: "api.example.com",
    });
  });

  it("owner bật cờ thì đám mây chạy; tắt lại thì chặn lại; admin/member không đổi được cờ", async () => {
    const ws_svc = createWorkspaceService({ db: t.db });
    const cloud = model({ local: false, host: "api.example.com" });
    for (const actorId of ["admin", "member", "lạ"])
      await expect(
        ws_svc.setAiCloud({ actorId, workspaceId: ws, enabled: true }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await ws_svc.getAiCloud({ actorId: "member", workspaceId: ws }),
    ).toEqual({ enabled: false });
    await ws_svc.setAiCloud({
      actorId: "owner",
      workspaceId: ws,
      enabled: true,
    });
    expect((await ask(cloud)).text).toBe("trả lời");
    expect(calls).toHaveLength(1);
    await ws_svc.setAiCloud({
      actorId: "owner",
      workspaceId: ws,
      enabled: false,
    });
    await expect(ask(cloud)).rejects.toBeInstanceOf(AiNotAllowedError);
    await expect(
      ws_svc.setAiCloud({
        actorId: "owner",
        workspaceId: ws,
        enabled: "yes" as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("nhật ký được ghi TRƯỚC khi gửi: ở thời điểm mô hình chạy, dòng đã có trạng thái sent", async () => {
    let seen: string | undefined;
    await ask(
      model({
        generate: async () => {
          seen = (await rows())[0]?.status;
          return { text: "x" };
        },
      }),
    );
    expect(seen).toBe("sent");
    expect((await rows())[0]!.status).toBe("ok");
  });

  it("không ghi được nhật ký thì không gửi (thất bại đóng)", async () => {
    // Chỉ `insert` hỏng; đọc (kiểm quyền) vẫn chạy để thấy đúng bước ghi nhật ký là bước chặn gửi.
    const broken = new Proxy(t.db, {
      get(target, prop, receiver) {
        if (prop === "insert")
          return () => {
            throw new Error("db hỏng");
          };
        return Reflect.get(target, prop, receiver);
      },
    });
    await expect(
      createAiGateway({ db: broken, model: model() }).complete({
        actorId: "member",
        workspaceId: ws,
        purpose: "answer",
        system: "s",
        user: "u",
        itemCount: 0,
      }),
    ).rejects.toThrow("db hỏng");
    expect(calls).toEqual([]);
  });

  it("mô hình lỗi: nhật ký thành error với mã an toàn, lỗi gốc được ném lại, không lộ nội dung", async () => {
    const err = new ModelError("model.http.500", "Mô hình trả 500");
    await expect(
      ask(
        model({
          generate: async () => {
            throw err;
          },
        }),
      ),
    ).rejects.toBe(err);
    const [d] = await rows();
    expect(d).toMatchObject({ status: "error", errorCode: "model.http.500" });
    // lỗi lạ (không phải ModelError) chỉ ghi mã chung
    await expect(
      ask(
        model({
          generate: async () => {
            throw new Error("postgres://u:pw@h/db sk-live-x");
          },
        }),
      ),
    ).rejects.toThrow();
    expect((await rows()).at(-1)).toMatchObject({
      status: "error",
      errorCode: "internal",
    });
    expect(JSON.stringify(await rows())).not.toMatch(/pw@|sk-live/);
  });

  it("trần byte: đúng trần được nhận, vượt trần bị từ chối trước khi ghi/gửi", async () => {
    await expect(
      ask(model(), { system: "", user: "x".repeat(MAX_PROMPT_BYTES) }),
    ).resolves.toBeDefined();
    await expect(
      ask(model(), { system: "", user: "x".repeat(MAX_PROMPT_BYTES + 1) }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("đếm byte theo UTF-8 (tiếng Việt có dấu nhiều byte)", async () => {
    await ask(model(), { system: "", user: "ệ".repeat(10) });
    expect((await rows())[0]!.bytesSent).toBe(30);
  });

  it("người ngoài workspace bị Forbidden trước khi gửi; mục đích và số mục sai bị từ chối", async () => {
    await expect(ask(model(), { actorId: "lạ" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    for (const over of [
      { purpose: "có khoảng trắng" },
      { purpose: "" },
      { itemCount: -1 },
      { itemCount: 1.5 },
    ])
      await expect(ask(model(), over)).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("CHECK của CSDL từ chối trạng thái lạ, số âm và mã lỗi không an toàn; xoá workspace xoá nhật ký", async () => {
    const base = {
      workspaceId: ws,
      actorId: "u",
      purpose: "p",
      endpointHost: "h",
      model: "m",
      local: true,
      itemCount: 0,
      bytesSent: 0,
    };
    for (const bad of [
      { status: "lạ" as never },
      { status: "ok" as const, itemCount: -1 },
      { status: "error" as const, errorCode: "có khoảng trắng và nội dung" },
    ])
      await expect(
        t.db
          .insert(aiDisclosures)
          .values(Object.assign({}, base, { status: "ok" }, bad) as never),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    await ask(model());
    await t.db.delete(workspaces).where(eq(workspaces.id, ws));
    expect(await rows()).toEqual([]);
  });
});
