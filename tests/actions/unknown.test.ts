import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import { actionLedger, drafts, workspaces } from "@/src/db/schema";
import { SocialApiError } from "@/src/providers/socialapi";
import type { ProviderMessage } from "@/src/providers/types";
import { ValidationError } from "@/src/providers/types";

import { type Env, H, NOW, setup } from "./helpers";

let e: Env;
beforeEach(async () => {
  e = await setup();
});
afterEach(async () => {
  await e.t.client.close();
});

const M = () => ({ actorId: "member", workspaceId: e.ws });
const out = (
  text: string,
  at: Date,
  over: Partial<ProviderMessage> = {},
): ProviderMessage => ({
  id: `mid-${crypto.randomUUID().slice(0, 8)}`,
  identityWeak: false,
  providerMessageId: "u",
  direction: "outgoing",
  author: "Shop",
  text,
  sentAt: at.toISOString(),
  ...over,
});
const listReturns = (...items: ProviderMessage[]) =>
  e.list.mockResolvedValue({ items, nextCursor: null });

/** Tạo một hành động đã rơi vào send_unknown (mất kết nối sau khi gửi). */
async function unknown(text = "Dạ còn ạ") {
  e.send.mockRejectedValueOnce(new SocialApiError("x", 0, "client.timeout"));
  const draftId = await e.draft(text);
  const a = await e.actions.requestSend({
    ...M(),
    draftId,
    idempotencyKey: `k-${crypto.randomUUID()}`,
  });
  await e.actions.dispatch({ actionId: a.id });
  return { a, draftId };
}
const get = (id: string) => e.actions.get({ ...M(), actionId: id });

describe("đối soát send_unknown", () => {
  it("thấy tin gửi đi cùng nội dung sau lúc gửi → confirmed kèm id tin; nháp thành sent; KHÔNG gọi sendMessage lần hai [F-006/AC-09]", async () => {
    const { a, draftId } = await unknown("Dạ còn ạ");
    listReturns(
      out("Dạ còn ạ", new Date(NOW.getTime() + 5_000), { id: "mid-found" }),
    );
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "confirmed",
    });
    expect(await get(a.id)).toMatchObject({
      state: "confirmed",
      providerMessageIds: ["mid-found"],
      reconcileResult: "found",
    });
    const [d] = await e.t.db
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId));
    expect(d!.status).toBe("sent");
    expect(e.send).toHaveBeenCalledTimes(1);
  });

  it("không thấy → giữ send_unknown kèm not_found (không chứng minh được là chưa gửi); thử lại được; vẫn không gửi lại [F-006/AC-09]", async () => {
    const { a } = await unknown();
    listReturns();
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "not_found",
    });
    const got = await get(a.id);
    expect(got).toMatchObject({
      state: "send_unknown",
      reconcileResult: "not_found",
    });
    e.state.now = new Date(NOW.getTime() + 10 * 60_000);
    listReturns(out("Dạ còn ạ", new Date(NOW.getTime() + 8 * 60_000)));
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "confirmed",
    });
    expect(e.send).toHaveBeenCalledTimes(1);
  });

  it("không nhận nhầm: tin cùng nội dung gửi TRƯỚC lúc gửi, tin ĐẾN cùng nội dung, hoặc tin khác nội dung [F-006/AC-09]", async () => {
    const { a } = await unknown("Dạ còn ạ");
    listReturns(
      out("Dạ còn ạ", new Date(NOW.getTime() - 10 * 60_000)), // đã có từ trước
      out("Dạ còn ạ", new Date(NOW.getTime() + 1_000), {
        direction: "incoming",
      }),
      out("Dạ hết rồi ạ", new Date(NOW.getTime() + 1_000)),
    );
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "not_found",
    });
    expect((await get(a.id)).state).toBe("send_unknown");
  });

  it("dung sai lệch đồng hồ 60 giây: sớm hơn 30 giây vẫn nhận, sớm hơn 61 giây thì không [F-006/AC-09]", async () => {
    const { a } = await unknown();
    listReturns(out("Dạ còn ạ", new Date(NOW.getTime() - 61_000)));
    expect((await e.actions.reconcile({ actionId: a.id })).status).toBe(
      "not_found",
    );
    listReturns(out("Dạ còn ạ", new Date(NOW.getTime() - 30_000)));
    expect((await e.actions.reconcile({ actionId: a.id })).status).toBe(
      "confirmed",
    );
  });

  it("so băm theo NFC và khoảng trắng đầu/cuối: tin trả về dạng NFD hoặc có xuống dòng thừa vẫn khớp", async () => {
    const { a } = await unknown("Dạ còn ạ");
    listReturns(
      out("  Dạ còn ạ\n".normalize("NFD"), new Date(NOW.getTime() + 1_000)),
    );
    expect((await e.actions.reconcile({ actionId: a.id })).status).toBe(
      "confirmed",
    );
  });

  it("đọc nhiều trang: tìm thấy ở trang hai; dừng khi gặp tin cũ hơn lúc gửi", async () => {
    const { a } = await unknown();
    e.list
      .mockResolvedValueOnce({
        items: [out("khác", new Date(NOW.getTime() + 9_000))],
        nextCursor: "p2",
      })
      .mockResolvedValueOnce({
        items: [out("Dạ còn ạ", new Date(NOW.getTime() + 3_000))],
        nextCursor: "p3",
      });
    expect((await e.actions.reconcile({ actionId: a.id })).status).toBe(
      "confirmed",
    );
    expect(e.list).toHaveBeenCalledTimes(2);

    const { a: b } = await unknown("hai");
    e.list.mockReset();
    e.list.mockResolvedValue({
      items: [out("cũ", new Date(NOW.getTime() - 3 * H))],
      nextCursor: "p2",
    });
    expect((await e.actions.reconcile({ actionId: b.id })).status).toBe(
      "not_found",
    );
    expect(e.list).toHaveBeenCalledTimes(1); // gặp tin cũ thì không đọc tiếp
  });

  it("lỗi đọc hoặc nhà cung cấp không đọc lại được: ghi error, giữ send_unknown, không lộ nội dung lỗi [F-006/AC-09]", async () => {
    const { a } = await unknown();
    e.list.mockRejectedValue(new Error("postgres://u:pw@h/db sk-live-x"));
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "error",
    });
    expect(await get(a.id)).toMatchObject({
      state: "send_unknown",
      reconcileResult: "error",
    });
    expect(JSON.stringify(await get(a.id))).not.toMatch(/pw@|sk-live/);
    e.state.provider = {
      id: "fake",
      label: "f",
      support: { facebook: ["dm"] },
    }; // không đọc lại được
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "error",
    });
    e.state.provider = undefined;
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "error",
    });
    expect(e.send).toHaveBeenCalledTimes(1);
  });

  it("chỉ đối soát hành động đang send_unknown", async () => {
    const d = await e.draft();
    const a = await e.actions.requestSend({
      ...M(),
      draftId: d,
      idempotencyKey: "k",
    });
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "skipped",
    });
    await e.actions.dispatch({ actionId: a.id });
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "skipped",
    });
    expect(
      await e.actions.reconcile({
        actionId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ status: "skipped" });
  });
});

describe("người quyết định send_unknown", () => {
  it("chỉ admin/owner; sent → confirmed và nháp thành sent; ghi người quyết định [F-006/AC-09]", async () => {
    const { a, draftId } = await unknown();
    await expect(
      e.actions.resolveUnknown({ ...M(), actionId: a.id, outcome: "sent" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const r = await e.actions.resolveUnknown({
      actorId: "admin",
      workspaceId: e.ws,
      actionId: a.id,
      outcome: "sent",
    });
    expect(r.state).toBe("confirmed");
    const [row] = await e.t.db
      .select()
      .from(actionLedger)
      .where(eq(actionLedger.id, a.id));
    expect(row!.resolvedBy).toBe("admin");
    const [d] = await e.t.db
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId));
    expect(d!.status).toBe("sent");
    expect(e.send).toHaveBeenCalledTimes(1);
  });

  it("not_sent → failed confirmed_not_sent và mở đường cho yêu cầu MỚI (khoá mới), không tự gửi lại [F-006/AC-09]", async () => {
    const { a, draftId } = await unknown();
    const r = await e.actions.resolveUnknown({
      actorId: "owner",
      workspaceId: e.ws,
      actionId: a.id,
      outcome: "not_sent",
    });
    expect(r).toMatchObject({
      state: "failed",
      errorCode: "confirmed_not_sent",
    });
    expect(e.send).toHaveBeenCalledTimes(1);
    const again = await e.actions.requestSend({
      ...M(),
      draftId,
      idempotencyKey: "k-moi",
    });
    expect(again.state).toBe("queued");
    await e.actions.dispatch({ actionId: again.id });
    expect(e.send).toHaveBeenCalledTimes(2); // lần gửi MỚI do người chủ động yêu cầu
  });

  it("đã quyết rồi hoặc không phải send_unknown là xung đột; kết quả lạ, id lạ, workspace khác bị từ chối [F-006/AC-09]", async () => {
    const { a } = await unknown();
    await e.actions.resolveUnknown({
      actorId: "admin",
      workspaceId: e.ws,
      actionId: a.id,
      outcome: "sent",
    });
    await expect(
      e.actions.resolveUnknown({
        actorId: "admin",
        workspaceId: e.ws,
        actionId: a.id,
        outcome: "not_sent",
      }),
    ).rejects.toMatchObject({ reason: "action_not_unknown" });
    await expect(
      e.actions.resolveUnknown({
        actorId: "admin",
        workspaceId: e.ws,
        actionId: a.id,
        outcome: "có" as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      e.actions.resolveUnknown({
        actorId: "admin",
        workspaceId: e.ws,
        actionId: "lạ",
        outcome: "sent",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const [w2] = await e.t.db
      .insert(workspaces)
      .values({ name: "B" })
      .returning();
    await expect(
      e.actions.resolveUnknown({
        actorId: "admin",
        workspaceId: w2!.id,
        actionId: a.id,
        outcome: "sent",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("huỷ", () => {
  const request = async (key = "k", actorId = "member") =>
    e.actions.requestSend({
      actorId,
      workspaceId: e.ws,
      draftId: await e.draft(),
      idempotencyKey: key,
    });

  it("queued → cancelled, không bao giờ gửi; dispatch sau đó bị bỏ qua [F-006/AC-10]", async () => {
    const a = await request();
    expect((await e.actions.cancel({ ...M(), actionId: a.id })).state).toBe(
      "cancelled",
    );
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "skipped",
    });
    expect(e.send).not.toHaveBeenCalled();
  });

  it("chỉ người tạo hoặc admin/owner huỷ được; người khác bị từ chối [F-006/AC-10]", async () => {
    const a = await request("k1", "member");
    await e.t.db
      .insert((await import("@/src/db/schema")).members)
      .values({ workspaceId: e.ws, userId: "other", role: "member" });
    await expect(
      e.actions.cancel({ actorId: "other", workspaceId: e.ws, actionId: a.id }),
    ).rejects.toMatchObject({ reason: "action_not_cancellable" });
    expect(
      (
        await e.actions.cancel({
          actorId: "admin",
          workspaceId: e.ws,
          actionId: a.id,
        })
      ).state,
    ).toBe("cancelled");
    await expect(
      e.actions.cancel({ actorId: "lạ", workspaceId: e.ws, actionId: a.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      e.actions.cancel({ ...M(), actionId: "lạ" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("huỷ khi đang gửi → cancel_requested; kết quả thật vẫn được ghi (không rút lại được tin đã đi) [F-006/AC-10]", async () => {
    const a = await request();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    e.send.mockImplementation(async () => {
      await gate;
      return { messageIds: ["m"] };
    });
    const running = e.actions.dispatch({ actionId: a.id });
    await new Promise((r) => setTimeout(r, 30));
    expect((await e.actions.cancel({ ...M(), actionId: a.id })).state).toBe(
      "cancel_requested",
    );
    release();
    expect((await running).status).toBe("sent");
    expect((await get(a.id)).state).toBe("confirmed");
  });

  it("đã xong, đang send_unknown, đã huỷ hoặc bị chặn thì không huỷ được [F-006/AC-10]", async () => {
    const done = await request("k1");
    await e.actions.dispatch({ actionId: done.id });
    await expect(
      e.actions.cancel({ ...M(), actionId: done.id }),
    ).rejects.toMatchObject({ reason: "action_not_cancellable" });
    const { a } = await unknown("khác");
    await expect(
      e.actions.cancel({ ...M(), actionId: a.id }),
    ).rejects.toMatchObject({ reason: "action_not_cancellable" });
    e.state.live = false;
    const blocked = await request("k3");
    expect(blocked.state).toBe("blocked");
    await expect(
      e.actions.cancel({ ...M(), actionId: blocked.id }),
    ).rejects.toMatchObject({ reason: "action_not_cancellable" });
  });
});

describe("việc nền", () => {
  it("dispatchDue gửi các hành động queued cũ nhất trước, theo trần lô; cờ tắt thì không đụng", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        (
          await e.actions.requestSend({
            ...M(),
            draftId: await e.draft(`tin ${i}`),
            idempotencyKey: `k${i}`,
          })
        ).id,
      );
      e.state.now = new Date(e.state.now.getTime() + 1000);
    }
    e.state.live = false;
    expect(
      Object.values(await e.actions.dispatchDue({ limit: 10 })).reduce(
        (x, y) => x + y,
        0,
      ),
    ).toBe(0);
    expect(e.send).not.toHaveBeenCalled();
    e.state.live = true;
    expect(await e.actions.dispatchDue({ limit: 2 })).toMatchObject({
      sent: 2,
    });
    expect(e.send.mock.calls.map((c) => c[0].text)).toEqual(["tin 0", "tin 1"]);
    expect((await get(ids[2]!)).state).toBe("queued");
    expect(await e.actions.dispatchDue({ limit: 10 })).toMatchObject({
      sent: 1,
    });
    expect(await e.actions.dispatchDue({ limit: 10 })).toMatchObject({
      sent: 0,
    });
  });

  it("reconcileDue chỉ chọn send_unknown đủ tuổi và chưa quá hạn; không đối soát lại quá dày", async () => {
    const { a } = await unknown();
    listReturns();
    const run = () =>
      e.actions.reconcileDue({ limit: 10, minAgeMs: 60_000, maxAgeMs: 24 * H });
    expect(await run()).toMatchObject({ not_found: 0 }); // mới 0 giây: chưa đủ tuổi
    e.state.now = new Date(NOW.getTime() + 61_000);
    expect(await run()).toMatchObject({ not_found: 1 });
    expect(await run()).toMatchObject({ not_found: 0 }); // vừa đối soát: chờ đủ minAge
    e.state.now = new Date(NOW.getTime() + 125_000);
    expect(await run()).toMatchObject({ not_found: 1 });
    e.state.now = new Date(NOW.getTime() + 25 * H);
    expect(await run()).toMatchObject({ not_found: 0 }); // quá hạn: để người quyết
    expect((await get(a.id)).state).toBe("send_unknown");
    expect(e.send).toHaveBeenCalledTimes(1);
  });
});
