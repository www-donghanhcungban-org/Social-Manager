import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAiGateway } from "@/src/ai/gateway";
import {
  AiBudgetError,
  AiNotAllowedError,
  type ModelPort,
} from "@/src/ai/port";
import { aiDisclosures, members, workspaces } from "@/src/db/schema";
import { createLogger } from "@/src/log/logger";
import { createMetrics } from "@/src/observability/metrics";

import { createTestDb } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
let ws: string;
let lines: Record<string, unknown>[];

const log = () =>
  createLogger({
    service: "t",
    version: "0",
    env: "test",
    write: (l) => lines.push(JSON.parse(l) as Record<string, unknown>),
  });

const model = (over: Partial<ModelPort> = {}): ModelPort => ({
  id: "fake",
  model: "m-1",
  local: true,
  host: "localhost",
  generate: async () => ({
    text: "trả lời bí mật",
    usage: { inputTokens: 120, outputTokens: 30 },
    responseModel: "m-1-2026",
  }),
  ...over,
});

const call = (
  gw: ReturnType<typeof createAiGateway>,
  purpose = "answer",
  user = "NỘI DUNG NHẠY CẢM CỦA KHÁCH",
) =>
  gw.complete({
    actorId: "member",
    workspaceId: ws,
    purpose,
    system: "s",
    user,
    itemCount: 1,
  });

beforeEach(async () => {
  lines = [];
  t = await createTestDb();
  const [w] = await t.db.insert(workspaces).values({ name: "A" }).returning();
  ws = w!.id;
  await t.db
    .insert(members)
    .values({ workspaceId: ws, userId: "member", role: "member" });
});
afterEach(async () => {
  await t.client.close();
});

describe("ngân sách AI (OPS-COST-004, AI-OBS-003)", () => {
  const budget = {
    maxCallsPerDay: 5,
    maxBytesPerDay: 1_000_000,
    maxCallsPerPurposePerDay: 100,
  };

  it("80% cảnh báo, 100% chặn bằng mã lỗi và không gọi mô hình thêm", async () => {
    let calls = 0;
    const gw = createAiGateway({
      db: t.db,
      model: model({
        generate: async () => {
          calls++;
          return { text: "ok" };
        },
      }),
      log: log(),
      budget,
    });
    for (let i = 0; i < 4; i++) await call(gw); // 4 lượt đã dùng = 80% trước lượt thứ 5
    expect(lines.some((l) => l.message === "ai budget warning")).toBe(false);
    await call(gw); // lượt 5: thấy 4/5 = 80% → cảnh báo
    const warn = lines.find((l) => l.message === "ai budget warning");
    expect(warn).toMatchObject({ level: "warn", workspace_id: ws });
    // đã dùng 5/5 = 100% → lượt 6 bị chặn
    await expect(call(gw)).rejects.toBeInstanceOf(AiBudgetError);
    expect(calls).toBe(5);
    const blocked = lines.find((l) => l.event === "ai.budget_exceeded");
    expect(blocked).toMatchObject({
      outcome: "denied",
      actor: "member",
      target_type: "workspace",
      target_id: ws,
    });
    const rows = await t.db.select().from(aiDisclosures);
    expect(rows.filter((r) => r.status === "blocked")).toHaveLength(1);
  });

  it("ngân sách tính theo workspace: workspace khác không bị ảnh hưởng", async () => {
    const [w2] = await t.db
      .insert(workspaces)
      .values({ name: "B" })
      .returning();
    await t.db
      .insert(members)
      .values({ workspaceId: w2!.id, userId: "member", role: "member" });
    const gw = createAiGateway({ db: t.db, model: model(), budget });
    for (let i = 0; i < 5; i++) await call(gw);
    await expect(call(gw)).rejects.toBeInstanceOf(AiBudgetError);
    await expect(
      gw.complete({
        actorId: "member",
        workspaceId: w2!.id,
        purpose: "answer",
        system: "s",
        user: "u",
        itemCount: 0,
      }),
    ).resolves.toMatchObject({ text: expect.any(String) });
  });

  it("trần theo tính năng: một purpose hết hạn mức không chặn purpose khác", async () => {
    const gw = createAiGateway({
      db: t.db,
      model: model(),
      budget: { ...budget, maxCallsPerDay: 100, maxCallsPerPurposePerDay: 2 },
    });
    await call(gw, "answer");
    await call(gw, "answer");
    await expect(call(gw, "answer")).rejects.toBeInstanceOf(AiBudgetError);
    await expect(call(gw, "labels")).resolves.toBeDefined();
  });

  it("trần byte: một lượt đẩy tổng byte qua trần thì lượt sau bị chặn", async () => {
    const gw = createAiGateway({
      db: t.db,
      model: model(),
      budget: { ...budget, maxBytesPerDay: 100 },
    });
    await call(gw, "answer", "x".repeat(150));
    await expect(call(gw)).rejects.toBeInstanceOf(AiBudgetError);
  });

  it("lượt bị chặn (blocked) không ăn ngân sách của lần sau", async () => {
    const gw = createAiGateway({
      db: t.db,
      model: model({ local: false, host: "api.example.com" }),
      budget,
    });
    for (let i = 0; i < 8; i++)
      await expect(call(gw)).rejects.toBeInstanceOf(AiNotAllowedError);
    await t.db.update(workspaces).set({ aiCloudEnabled: true });
    await expect(call(gw)).resolves.toBeDefined();
  });
});

describe("quan sát lời gọi AI (AI-OBS-001/004, OPS-COST-003)", () => {
  it("ghi span gen_ai.* đủ thuộc tính, KHÔNG có nội dung prompt hay câu trả lời", async () => {
    const metrics = createMetrics();
    const gw = createAiGateway({
      db: t.db,
      model: model(),
      log: log(),
      metrics,
    });
    await call(gw, "answer", "NỘI DUNG NHẠY CẢM CỦA KHÁCH");
    const span = lines.find((l) => l.message === "gen_ai.client.operation");
    expect(span).toMatchObject({
      "gen_ai.provider.name": "fake",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "m-1",
      "gen_ai.response.model": "m-1-2026",
      "gen_ai.usage.input_tokens": 120,
      "gen_ai.usage.output_tokens": 30,
    });
    const all = JSON.stringify(lines);
    expect(all).not.toContain("NỘI DUNG NHẠY CẢM");
    expect(all).not.toContain("bí mật");
    const text = metrics.render();
    expect(text).toContain(
      `llm_tokens_total{direction="input",feature="answer",model="m-1",tenant="${ws}"} 120`,
    );
    expect(text).toContain('direction="output"');
  });

  it("chặn AI đám mây chưa cho phép ghi sự kiện ai.blocked", async () => {
    const gw = createAiGateway({
      db: t.db,
      model: model({ local: false, host: "api.example.com" }),
      log: log(),
    });
    await expect(call(gw)).rejects.toBeInstanceOf(AiNotAllowedError);
    expect(lines.find((l) => l.event === "ai.blocked")).toMatchObject({
      outcome: "denied",
      actor: "member",
    });
  });
});
