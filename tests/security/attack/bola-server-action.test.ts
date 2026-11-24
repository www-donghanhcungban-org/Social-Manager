import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  removeConnectionAction,
  setWebhookSecretAction,
} from "@/app/app/[workspaceId]/connections/actions";
import {
  discardDraftAction,
  saveDraftAction,
} from "@/app/app/[workspaceId]/conversations/actions";
import { setAiCloudAction } from "@/app/app/[workspaceId]/actions";
import { ForbiddenError } from "@/src/auth/errors";
import { addMember, changeRole } from "@/src/auth/members";
import {
  conversations,
  drafts,
  members,
  providerConnections,
  socialAccounts,
} from "@/src/db/schema";

import { createWorld, outcome, type World } from "./world";

/**
 * Tấn công BOLA/BFLA (OWASP API1/API5 2023) qua ĐÚNG đường người dùng đi: Server Action thật → `requireWorkspace` thật →
 * phiên Better Auth thật (cookie từ đăng nhập thật) → dịch vụ thật trên Postgres (PGlite). Chỉ thay phần khung của Next
 * không chạy được ngoài server (`headers()`, `revalidatePath`) và gốc ghép nối đọc biến môi trường (container/auth dựng từ
 * env) bằng bản dựng trên PGlite — không thay chính lớp kiểm quyền nào.
 */
const live = vi.hoisted(() => ({
  world: undefined as unknown as World,
  headers: new Headers(),
}));
vi.mock("next/headers", () => ({ headers: async () => live.headers }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/src/server/container", () => ({
  createContainer: () => live.world.container,
}));
vi.mock("@/src/auth/server", () => ({ getAuth: () => live.world.auth }));
vi.mock("@/src/config/env", async (orig) => ({
  ...(await orig<typeof import("@/src/config/env")>()),
  loadEnv: () => ({}),
}));

const initial = { message: null, error: false, runs: 0 };
const noState = { error: null };
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

let w: World;
let victim: { id: string; headers: Headers };
let attacker: { id: string; headers: Headers };
let member: { id: string; headers: Headers };
let wsV: string; // workspace của nạn nhân
let wsX: string; // workspace riêng của kẻ tấn công (hắn là owner ở đó)
let connV: string;
let convV: string;
let draftV: string;
const GHOST = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  w = await createWorld();
  live.world = w;
  victim = await w.login("nan-nhan@example.com");
  attacker = await w.login("ke-tan-cong@example.com");
  member = await w.login("thanh-vien@example.com");
  wsV = (await w.services.workspaces.create({ actorId: victim.id, name: "V" }))
    .id;
  wsX = (
    await w.services.workspaces.create({ actorId: attacker.id, name: "X" })
  ).id;
  await addMember(w.db, {
    actorId: victim.id,
    workspaceId: wsV,
    userId: member.id,
    role: "member",
  });
  const [c] = await w.db
    .insert(providerConnections)
    .values({
      workspaceId: wsV,
      provider: "demo",
      label: "kết nối V",
      credentialsEnc: w.box.encrypt("KHOA-V"),
    })
    .returning();
  connV = c!.id;
  const [a] = await w.db
    .insert(socialAccounts)
    .values({
      connectionId: connV,
      platform: "facebook",
      externalId: "trang-v",
      displayName: "Trang V",
    })
    .returning();
  const [cv] = await w.db
    .insert(conversations)
    .values({
      workspaceId: wsV,
      socialAccountId: a!.id,
      externalId: "conv-v",
      participantId: "khach",
      participantName: "Khách",
    })
    .returning();
  convV = cv!.id;
  draftV = (
    await w.services.drafts.create({
      actorId: victim.id,
      workspaceId: wsV,
      conversationId: convV,
      text: "Nháp của nạn nhân",
    })
  ).id;
});
afterAll(async () => {
  await w.t.client.close();
});

/** Ảnh chụp mọi thứ kẻ tấn công nhắm tới trong workspace V. */
async function snapshotV() {
  const [conn] = await w.db
    .select({
      id: providerConnections.id,
      secret: providerConnections.webhookSecretEnc,
    })
    .from(providerConnections)
    .where(eq(providerConnections.id, connV));
  const ds = await w.db
    .select({ id: drafts.id, status: drafts.status, v: drafts.currentVersion })
    .from(drafts)
    .where(eq(drafts.conversationId, convV));
  const ai = await w.services.workspaces.getAiCloud({
    actorId: victim.id,
    workspaceId: wsV,
  });
  return { conn, ds, ai };
}

const as = (u: { headers: Headers }) => {
  live.headers = u.headers;
};

describe("api1-bola qua Server Action: người ngoài nhắm workspace của người khác", () => {
  it("mọi action với workspaceId của V → notFound, giống hệt workspace không tồn tại; V không đổi", async () => {
    as(attacker);
    const before = await snapshotV();
    for (const ws of [wsV, GHOST, "khong-phai-uuid"]) {
      const calls: Promise<unknown>[] = [
        saveDraftAction(ws, convV, initial, form({ text: "chèn" })),
        discardDraftAction(ws, convV, draftV, initial),
        setAiCloudAction(ws, noState as never, form({ enabled: "true" })),
        removeConnectionAction(ws, connV),
        setWebhookSecretAction(
          ws,
          connV,
          noState,
          form({ secret: "x".repeat(40) }),
        ),
      ];
      for (const r of await Promise.all(calls.map((p) => outcome(p))))
        expect(r.ok ? "đã chạy" : r.signal, ws).toBe("not_found");
    }
    expect(await snapshotV()).toEqual(before);
  });

  it("dùng workspace của chính mình + id đối tượng của V → 'Không tìm thấy', y như id không tồn tại; V không đổi", async () => {
    as(attacker);
    const before = await snapshotV();
    const foreign = await saveDraftAction(
      wsX,
      convV,
      initial,
      form({ text: "chèn nháp" }),
    );
    const ghost = await saveDraftAction(
      wsX,
      GHOST,
      initial,
      form({ text: "chèn nháp" }),
    );
    expect(foreign).toEqual({
      message: "Không tìm thấy mục này.",
      error: true,
      runs: 1,
    });
    // Không phân biệt "có thật nhưng không phải của anh" với "không tồn tại".
    expect(foreign).toEqual(ghost);
    expect(
      await saveDraftAction(
        wsX,
        convV,
        initial,
        form({ draftId: draftV, baseVersion: "1", text: "sửa nháp" }),
      ),
    ).toMatchObject({ error: true, message: "Không tìm thấy mục này." });
    expect(await discardDraftAction(wsX, convV, draftV, initial)).toMatchObject(
      { error: true, message: "Không tìm thấy mục này." },
    );
    expect(
      await setWebhookSecretAction(
        wsX,
        connV,
        noState,
        form({ secret: "y".repeat(40) }),
      ),
    ).toEqual({ error: "Không tìm thấy mục này (có thể đã bị xoá)." });
    // Xoá idempotent: báo xong nhưng thực tế không chạm được kết nối của V.
    await expect(removeConnectionAction(wsX, connV)).resolves.toBeUndefined();
    expect(await snapshotV()).toEqual(before);
  });

  it("đồng thời: 30 lời gọi song song chéo workspace → tất cả bị chặn, không có dòng nào lọt", async () => {
    as(attacker);
    const before = await snapshotV();
    const calls = Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0
        ? saveDraftAction(wsV, convV, initial, form({ text: `đua ${i}` }))
        : i % 3 === 1
          ? saveDraftAction(wsX, convV, initial, form({ text: `đua ${i}` }))
          : discardDraftAction(wsX, convV, draftV, initial),
    );
    const results = await Promise.all(calls.map((p) => outcome(p)));
    for (const r of results) {
      if (r.ok) expect(r.value).toMatchObject({ error: true });
      else expect(r.signal).toBe("not_found");
    }
    expect(await snapshotV()).toEqual(before);
  });

  it("không có phiên, cookie giả hoặc cookie đã sửa → chuyển về /login, không chạy gì", async () => {
    const before = await snapshotV();
    // Sửa một ký tự của mã phiên thật (giữ nguyên chữ ký): chữ ký HMAC không còn khớp.
    const session = victim.headers
      .get("cookie")!
      .split("; ")
      .find((c) => c.includes("session_token="))!;
    const cut = session.indexOf("=") + 1;
    const tampered = `${session.slice(0, cut)}${session[cut] === "A" ? "B" : "A"}${session.slice(cut + 1)}`;
    // Đối chứng: chính cookie thật được nhận (đi tới kiểm workspace, không bị đẩy về /login).
    live.headers = new Headers({ cookie: session });
    const real = await outcome(
      saveDraftAction(GHOST, convV, initial, form({ text: "x" })),
    );
    expect(real.ok ? "đã chạy" : real.signal).toBe("not_found");
    for (const h of [
      new Headers(),
      new Headers({ cookie: "better-auth.session_token=gia-mao.chu-ky-sai" }),
      new Headers({ cookie: tampered }),
    ]) {
      live.headers = h;
      const r = await outcome(
        saveDraftAction(wsV, convV, initial, form({ text: "x" })),
      );
      expect(r.ok ? "đã chạy" : r.signal).toBe("redirect");
    }
    expect(await snapshotV()).toEqual(before);
  });
});

describe("api5-bfla qua Server Action: thành viên gọi chức năng của owner/admin", () => {
  it("member của V: không đổi cấu hình AI, không đặt secret webhook, không xoá kết nối", async () => {
    as(member);
    const before = await snapshotV();
    expect(
      await setAiCloudAction(wsV, noState as never, form({ enabled: "true" })),
    ).toEqual({
      error: "Chỉ chủ workspace đổi được cài đặt này.",
      saved: false,
    });
    expect(
      await setWebhookSecretAction(
        wsV,
        connV,
        noState,
        form({ secret: "z".repeat(40) }),
      ),
    ).toEqual({ error: "Bạn không có quyền thực hiện thao tác này." });
    // Action xoá chỉ nuốt NotFound (idempotent); thiếu quyền phải nổi lên, không giả vờ thành công.
    await expect(removeConnectionAction(wsV, connV)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await snapshotV()).toEqual(before);
  });

  it("đối chứng được phép: member lưu được nháp (inbox.reply), owner đổi được cấu hình AI", async () => {
    as(member);
    expect(
      await saveDraftAction(
        wsV,
        convV,
        initial,
        form({ draftId: draftV, baseVersion: "1", text: "member sửa" }),
      ),
    ).toMatchObject({ error: false });
    as(victim);
    expect(
      await setAiCloudAction(wsV, noState as never, form({ enabled: "true" })),
    ).toEqual({ error: null, saved: true });
    expect(
      await w.services.workspaces.getAiCloud({
        actorId: victim.id,
        workspaceId: wsV,
      }),
    ).toEqual({ enabled: true });
  });

  it("leo thang vai trò: member tự nâng mình, admin nâng người khác lên owner, người ngoài thêm mình → Forbidden", async () => {
    const [admin] = await w.db
      .insert(members)
      .values({ workspaceId: wsV, userId: "admin-v", role: "admin" })
      .returning();
    const roleOf = async (userId: string) =>
      (
        await w.db
          .select({ role: members.role })
          .from(members)
          .where(eq(members.userId, userId))
      ).map((r) => r.role);
    const attempts = [
      changeRole(w.db, {
        actorId: member.id,
        workspaceId: wsV,
        targetUserId: member.id,
        newRole: "owner",
      }),
      changeRole(w.db, {
        actorId: admin!.userId,
        workspaceId: wsV,
        targetUserId: member.id,
        newRole: "owner",
      }),
      addMember(w.db, {
        actorId: admin!.userId,
        workspaceId: wsV,
        userId: "ban-cua-admin",
        role: "owner",
      }),
      addMember(w.db, {
        actorId: attacker.id,
        workspaceId: wsV,
        userId: attacker.id,
        role: "member",
      }),
    ];
    // Song song: khoá dòng workspace tuần tự hoá, không lần nào lọt qua kiểm quyền.
    const results = await Promise.allSettled(attempts);
    for (const r of results) {
      expect(r.status).toBe("rejected");
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(await roleOf(member.id)).toEqual(["member"]);
    expect(await roleOf("ban-cua-admin")).toEqual([]);
    const [{ n } = { n: -1 }] = await w.db
      .select({ n: count() })
      .from(members)
      .where(eq(members.userId, attacker.id));
    expect(n).toBe(1); // chỉ là owner của workspace X của chính hắn
  });
});
