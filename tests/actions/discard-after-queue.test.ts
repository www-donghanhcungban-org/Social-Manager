import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createActionService } from "@/src/actions/ledger";
import { ConflictError, ForbiddenError } from "@/src/auth/errors";
import { actionLedger, drafts, members } from "@/src/db/schema";
import { SocialApiError } from "@/src/providers/socialapi";

import { type Env, setup } from "./helpers";

let e: Env;
beforeEach(async () => {
  e = await setup();
});
afterEach(async () => {
  await e.t.client.close();
});

const M = () => ({ actorId: "member", workspaceId: e.ws });
const request = (draftId: string, key = "k1") =>
  e.actions.requestSend({ ...M(), draftId, idempotencyKey: key });
const discard = (draftId: string, actorId = "member") =>
  e.drafts.discard({ actorId, workspaceId: e.ws, draftId });

async function row(id: string) {
  const [r] = await e.t.db
    .select()
    .from(actionLedger)
    .where(eq(actionLedger.id, id));
  return r!;
}
async function draftStatus(id: string) {
  const [d] = await e.t.db.select().from(drafts).where(eq(drafts.id, id));
  return d!.status;
}

/** Nhà cung cấp chờ tới khi test mở cổng: giữ hành động ở `dispatching`. */
function holdSend() {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  e.send.mockImplementationOnce(async () => {
    await gate;
    return { messageIds: ["m"] };
  });
  return () => release();
}

describe("bỏ nháp đã yêu cầu gửi", () => {
  it("queued → bỏ nháp huỷ hành động trong cùng giao dịch; việc nền không gọi nhà cung cấp", async () => {
    const draftId = await e.draft("Dạ còn ạ");
    const a = await request(draftId);
    expect((await discard(draftId)).status).toBe("discarded");
    expect(await row(a.id)).toMatchObject({
      state: "cancelled",
      errorCode: "draft_discarded",
    });
    expect((await row(a.id)).finishedAt).not.toBeNull();
    expect(await e.actions.dispatchDue({ limit: 20 })).toMatchObject({
      sent: 0,
    });
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "skipped",
    });
    expect(e.send).not.toHaveBeenCalled();
    expect(await draftStatus(draftId)).toBe("discarded");
  });

  it("thành viên khác bỏ nháp cũng huỷ; người ngoài bị từ chối và hành động vẫn queued", async () => {
    await e.t.db
      .insert(members)
      .values({ workspaceId: e.ws, userId: "other", role: "member" });
    const draftId = await e.draft();
    const a = await request(draftId);
    await expect(discard(draftId, "lạ")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await row(a.id)).state).toBe("queued");
    expect(await draftStatus(draftId)).toBe("open");
    await discard(draftId, "other");
    expect((await row(a.id)).state).toBe("cancelled");
    await e.actions.dispatchDue({ limit: 20 });
    expect(e.send).not.toHaveBeenCalled();
  });

  it("bỏ nháp A đang chờ rồi gửi nháp B: khách chỉ nhận B", async () => {
    const dA = await e.draft("Giá 500k ạ");
    await request(dA, "kA");
    await discard(dA);
    const dB = await e.draft("Xin lỗi, giá đúng là 450k ạ");
    await request(dB, "kB");
    expect(await e.actions.dispatchDue({ limit: 20 })).toMatchObject({
      sent: 1,
    });
    expect(e.send.mock.calls.map((c) => c[0].text)).toEqual([
      "Xin lỗi, giá đúng là 450k ạ",
    ]);
  });

  it("đang gửi (dispatching) → từ chối draft_send_pending; nháp vẫn mở, sổ không đổi; gửi xong thì nháp sent", async () => {
    const release = holdSend();
    const draftId = await e.draft();
    const a = await request(draftId);
    const running = e.actions.dispatch({ actionId: a.id });
    await vi.waitFor(() => expect(e.send).toHaveBeenCalledTimes(1));
    const err = await discard(draftId).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).toMatchObject({ reason: "draft_send_pending" });
    expect(await draftStatus(draftId)).toBe("open");
    expect((await row(a.id)).state).toBe("dispatching");
    release();
    expect(await running).toEqual({ status: "sent" });
    expect(await draftStatus(draftId)).toBe("sent");
  });

  it("send_unknown hoặc cancel_requested → từ chối draft_send_pending (không huỷ được an toàn)", async () => {
    e.send.mockRejectedValueOnce(new SocialApiError("x", 0, "client.timeout"));
    const dU = await e.draft("một");
    const u = await request(dU, "kU");
    await e.actions.dispatch({ actionId: u.id });
    expect((await row(u.id)).state).toBe("send_unknown");
    await expect(discard(dU)).rejects.toMatchObject({
      reason: "draft_send_pending",
    });
    expect(await draftStatus(dU)).toBe("open");

    const release = holdSend();
    const dC = await e.draft("hai");
    const c = await request(dC, "kC");
    const running = e.actions.dispatch({ actionId: c.id });
    await vi.waitFor(() => expect(e.send).toHaveBeenCalledTimes(2));
    await e.actions.cancel({ ...M(), actionId: c.id });
    expect((await row(c.id)).state).toBe("cancel_requested");
    await expect(discard(dC)).rejects.toMatchObject({
      reason: "draft_send_pending",
    });
    expect(await draftStatus(dC)).toBe("open");
    release();
    await running;
  });

  it("nháp đã đóng vẫn là draft_closed; nháp chỉ có hành động đã kết thúc (blocked) bỏ được, sổ giữ nguyên", async () => {
    const sent = await e.draft("một");
    await e.actions.dispatch({ actionId: (await request(sent, "k1")).id });
    await expect(discard(sent)).rejects.toMatchObject({
      reason: "draft_closed",
    });
    e.state.live = false;
    const dB = await e.draft("hai");
    const b = await request(dB, "k2");
    e.state.live = true;
    expect(b.state).toBe("blocked");
    expect((await discard(dB)).status).toBe("discarded");
    expect((await row(b.id)).state).toBe("blocked");
    await expect(discard(dB)).rejects.toMatchObject({ reason: "draft_closed" });
  });

  it("bỏ nháp và gửi chạy song song: không bao giờ vừa bỏ thành công vừa gửi", async () => {
    for (let i = 0; i < 5; i++) {
      const draftId = await e.draft(`tin ${i}`);
      const a = await request(draftId, `k${i}`);
      const before = e.send.mock.calls.length;
      const [d, s] = await Promise.allSettled([
        discard(draftId),
        e.actions.dispatch({ actionId: a.id }),
      ]);
      const sentNow = e.send.mock.calls.length - before;
      const state = (await row(a.id)).state;
      if (d.status === "fulfilled") {
        expect(sentNow).toBe(0);
        expect(state).toBe("cancelled");
      } else {
        expect(d.reason).toMatchObject({ reason: "draft_send_pending" });
        expect(sentNow).toBe(1);
        expect(state).toBe("confirmed");
      }
      expect(s.status).toBe("fulfilled");
    }
  });

  it("hai người cùng bỏ một nháp: một thắng, người kia nhận draft_closed", async () => {
    const draftId = await e.draft();
    const a = await request(draftId);
    const r = await Promise.allSettled([discard(draftId), discard(draftId)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = r.find((x) => x.status === "rejected");
    expect(lost?.reason).toMatchObject({ reason: "draft_closed" });
    expect((await row(a.id)).state).toBe("cancelled");
  });
});

describe("dispatch kiểm nháp còn mở", () => {
  it("nháp đóng sau khi xếp hàng mà hành động còn queued (đua với yêu cầu gửi) → cancelled lúc nhận việc, không gọi nhà cung cấp", async () => {
    const draftId = await e.draft();
    const a = await request(draftId);
    await e.t.db
      .update(drafts)
      .set({ status: "discarded" })
      .where(eq(drafts.id, draftId));
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "cancelled",
    });
    expect(await row(a.id)).toMatchObject({
      state: "cancelled",
      errorCode: "draft_closed",
      attempts: 1,
    });
    expect(e.send).not.toHaveBeenCalled();
    // đường nền đếm đúng
    const b = await request(await e.draft("hai"), "k2");
    await e.t.db
      .update(drafts)
      .set({ status: "discarded" })
      .where(eq(drafts.id, b.draftId!));
    expect(await e.actions.dispatchDue({ limit: 20 })).toMatchObject({
      cancelled: 1,
      sent: 0,
    });
    expect(e.send).not.toHaveBeenCalled();
  });

  it("nháp bị bỏ ngay trước khi gửi (sau mọi kiểm tra khác) → đọc lại thấy, cancelled, không gọi nhà cung cấp", async () => {
    const draftId = await e.draft();
    const a = await request(draftId);
    let discarding: Promise<unknown> | undefined;
    const svc = createActionService({
      db: e.t.db,
      box: e.box,
      // Gọi ngay trước khi gửi, sau mọi kiểm tra chính sách: một người bỏ nháp đúng lúc này (ghi thẳng, giao dịch khác).
      resolveProvider: () => {
        discarding = e.t.client.query(
          "update drafts set status = 'discarded' where id = $1",
          [draftId],
        );
        return e.state.provider;
      },
      live: () => true,
      now: () => e.state.now,
    });
    expect(await svc.dispatch({ actionId: a.id })).toEqual({
      status: "cancelled",
    });
    await discarding;
    expect(await row(a.id)).toMatchObject({
      state: "cancelled",
      errorCode: "draft_closed",
    });
    expect(e.send).not.toHaveBeenCalled();
  });
});
