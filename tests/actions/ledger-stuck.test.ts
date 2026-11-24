import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createActionService } from "@/src/actions/ledger";
import { ForbiddenError } from "@/src/auth/errors";
import { actionLedger, drafts } from "@/src/db/schema";
import { SocialApiError } from "@/src/providers/socialapi";
import { SendRejectedError, type ProviderMessage } from "@/src/providers/types";

import { type Env, H, NOW, setup } from "./helpers";

let e: Env;
beforeEach(async () => {
  e = await setup();
});
afterEach(async () => {
  await e.t.client.close();
});

const MIN = 60_000;
/** Ngưỡng truyền vào trong test; giá trị thật của job nằm ở runner (test runner kiểm). */
const STUCK = 10 * MIN;
const M = () => ({ actorId: "member", workspaceId: e.ws });
const at = (ms: number) => new Date(NOW.getTime() + ms);
const recover = () => e.actions.recoverStuck({ olderThanMs: STUCK });

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
const outgoing = (text: string, sentAt: Date): ProviderMessage => ({
  id: "mid-found",
  identityWeak: false,
  providerMessageId: "u",
  direction: "outgoing",
  author: "Shop",
  text,
  sentAt: sentAt.toISOString(),
});

/** Hành động kẹt `dispatching`: nhà cung cấp không bao giờ trả lời (tiến trình chết giữa lúc gửi). */
async function stuck(text = "Dạ còn ạ") {
  const before = e.send.mock.calls.length;
  e.send.mockImplementationOnce(() => new Promise(() => {}));
  const draftId = await e.draft(text);
  const a = await e.actions.requestSend({
    ...M(),
    draftId,
    idempotencyKey: `k-${text}`,
  });
  void e.actions.dispatch({ actionId: a.id });
  await vi.waitFor(() => expect(e.send.mock.calls.length).toBe(before + 1));
  expect((await row(a.id)).state).toBe("dispatching");
  return { a, draftId };
}

/**
 * Worker thứ hai trên cùng CSDL, CSDL bọc để ném lỗi như mất kết nối ở lần gọi `select`/`update` thứ n (đếm từ lúc tạo).
 * Lỗi ném đồng bộ lúc dựng truy vấn — với hàm async tương đương truy vấn bị từ chối.
 */
function worker(fault: {
  select?: (n: number) => boolean;
  update?: (n: number) => boolean;
}) {
  const seen = { select: 0, update: 0, injected: 0 };
  const db = new Proxy(e.t.db, {
    get(target, prop, recv) {
      const v: unknown = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      if (prop !== "select" && prop !== "update") return v.bind(target);
      return (...args: unknown[]) => {
        const n = ++seen[prop];
        if (fault[prop]?.(n)) {
          seen.injected++;
          throw new Error("Connection terminated unexpectedly");
        }
        return Reflect.apply(v, target, args);
      };
    },
  });
  const svc = createActionService({
    db,
    box: e.box,
    resolveProvider: () => e.state.provider,
    live: () => e.state.live,
    now: () => e.state.now,
  });
  return { svc, seen };
}

describe("hành động kẹt giữa chừng → send_unknown (không bao giờ gửi lại)", () => {
  it("dòng dispatching trẻ hơn ngưỡng không bị đụng; đủ ngưỡng → send_unknown `interrupted`; không về queued, không gửi lại [F-006/AC-08]", async () => {
    const { a } = await stuck();
    e.state.now = at(STUCK - 1);
    expect(await recover()).toBe(0);
    expect((await row(a.id)).state).toBe("dispatching");

    e.state.now = at(STUCK);
    expect(await recover()).toBe(1);
    expect(await row(a.id)).toMatchObject({
      state: "send_unknown",
      errorCode: "interrupted",
      attempts: 1,
      dispatchedAt: NOW,
    });
    expect(await recover()).toBe(0); // lũy đẳng
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "skipped",
    });
    expect(await e.actions.dispatchDue({ limit: 20 })).toMatchObject({
      sent: 0,
      failed: 0,
    });
    expect(e.send).toHaveBeenCalledTimes(1);
  });

  it("sau khi gỡ, đối soát nền thấy tin đã đi → confirmed, nháp sent; KHÔNG gọi sendMessage lần hai [F-006/AC-09]", async () => {
    const { a, draftId } = await stuck("Dạ còn ạ");
    e.state.now = at(STUCK);
    await recover();
    e.list.mockResolvedValue({
      items: [outgoing("Dạ còn ạ", at(1_000))],
      nextCursor: null,
    });
    e.state.now = at(STUCK + 2 * MIN);
    expect(
      await e.actions.reconcileDue({
        limit: 20,
        minAgeMs: 2 * MIN,
        maxAgeMs: 24 * H,
      }),
    ).toMatchObject({ confirmed: 1 });
    expect(await row(a.id)).toMatchObject({
      state: "confirmed",
      reconcileResult: "found",
      providerMessageIds: ["mid-found"],
    });
    expect(await draftStatus(draftId)).toBe("sent");
    expect(e.send).toHaveBeenCalledTimes(1);
  });

  it("sau khi gỡ: nháp còn khoá tới khi người quyết; member không quyết được; owner not_sent → yêu cầu MỚI được và gửi đúng một lần", async () => {
    const { a, draftId } = await stuck();
    e.state.now = at(STUCK);
    await recover();
    // hành vi send_unknown hiện có: chưa quyết thì không yêu cầu gửi lại bằng khoá khác
    await expect(
      e.actions.requestSend({ ...M(), draftId, idempotencyKey: "k-moi" }),
    ).rejects.toMatchObject({ reason: "idempotency_conflict" });
    await expect(
      e.actions.resolveUnknown({ ...M(), actionId: a.id, outcome: "not_sent" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await e.actions.resolveUnknown({
        actorId: "owner",
        workspaceId: e.ws,
        actionId: a.id,
        outcome: "not_sent",
      }),
    ).toMatchObject({ state: "failed", errorCode: "confirmed_not_sent" });
    await e.addMessage({ sentAt: e.state.now });
    const again = await e.actions.requestSend({
      ...M(),
      draftId,
      idempotencyKey: "k-moi",
    });
    expect(again.state).toBe("queued");
    expect(await e.actions.dispatch({ actionId: again.id })).toEqual({
      status: "sent",
    });
    expect(e.send).toHaveBeenCalledTimes(2); // lần MỚI do người chủ động yêu cầu
  });

  it("cancel_requested kẹt cũng được gỡ thành send_unknown (tin có thể đã đi, huỷ không rút lại được)", async () => {
    const { a } = await stuck();
    expect((await e.actions.cancel({ ...M(), actionId: a.id })).state).toBe(
      "cancel_requested",
    );
    e.state.now = at(STUCK - 1);
    expect(await recover()).toBe(0);
    e.state.now = at(STUCK);
    expect(await recover()).toBe(1);
    expect(await row(a.id)).toMatchObject({
      state: "send_unknown",
      errorCode: "interrupted",
    });
    expect(e.send).toHaveBeenCalledTimes(1);
  });

  it("không đụng trạng thái khác: queued cũ, confirmed, failed, blocked, send_unknown sẵn có giữ nguyên; luồng thường gửi đúng một lần", async () => {
    const ok = await e.actions.requestSend({
      ...M(),
      draftId: await e.draft("một"),
      idempotencyKey: "k1",
    });
    expect(await e.actions.dispatch({ actionId: ok.id })).toEqual({
      status: "sent",
    });
    const waiting = await e.actions.requestSend({
      ...M(),
      draftId: await e.draft("hai"),
      idempotencyKey: "k2",
    });
    e.send.mockRejectedValueOnce(new SendRejectedError("http.400", "rejected"));
    const bad = await e.actions.requestSend({
      ...M(),
      draftId: await e.draft("ba"),
      idempotencyKey: "k3",
    });
    await e.actions.dispatch({ actionId: bad.id });
    e.send.mockRejectedValueOnce(new SocialApiError("x", 0, "client.timeout"));
    const unk = await e.actions.requestSend({
      ...M(),
      draftId: await e.draft("bốn"),
      idempotencyKey: "k4",
    });
    await e.actions.dispatch({ actionId: unk.id });
    e.state.live = false;
    const blk = await e.actions.requestSend({
      ...M(),
      draftId: await e.draft("năm"),
      idempotencyKey: "k5",
    });
    e.state.live = true;

    e.state.now = at(48 * H);
    expect(await recover()).toBe(0);
    expect((await row(ok.id)).state).toBe("confirmed");
    expect((await row(waiting.id)).state).toBe("queued");
    expect((await row(bad.id)).state).toBe("failed");
    expect(await row(unk.id)).toMatchObject({
      state: "send_unknown",
      errorCode: "client.timeout",
    });
    expect((await row(blk.id)).state).toBe("blocked");
    expect(e.send).toHaveBeenCalledTimes(3);
  });

  it("nhiều worker gỡ song song: mỗi dòng chỉ được gỡ một lần", async () => {
    await stuck("một");
    await stuck("hai");
    e.state.now = at(STUCK);
    const counts = await Promise.all([recover(), recover(), recover()]);
    expect(counts.reduce((x, y) => x + y, 0)).toBe(2);
    const states = (await e.t.db.select().from(actionLedger)).map(
      (r) => r.state,
    );
    expect(states).toEqual(["send_unknown", "send_unknown"]);
  });

  it("nhà cung cấp trả lời muộn sau khi đã gỡ: không đè send_unknown, không gửi lại [F-006/AC-08]", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    e.send.mockImplementationOnce(async () => {
      await gate;
      return { messageIds: ["late"] };
    });
    const a = await e.actions.requestSend({
      ...M(),
      draftId: await e.draft(),
      idempotencyKey: "k",
    });
    const running = e.actions.dispatch({ actionId: a.id });
    await vi.waitFor(() => expect(e.send).toHaveBeenCalledTimes(1));
    e.state.now = at(STUCK);
    expect(await recover()).toBe(1);
    release();
    await running;
    expect(await row(a.id)).toMatchObject({
      state: "send_unknown",
      errorCode: "interrupted",
    });
    expect(e.send).toHaveBeenCalledTimes(1);
  });
});

describe("lỗi CSDL trước khi gọi nhà cung cấp → failed (chắc chắn chưa gửi), không kẹt", () => {
  // 6 lần đọc sau khi nhận việc: trạng thái nháp, workspace, nội dung, đích, tin đến gần nhất, đọc lại nháp trước khi gửi.
  it.each([1, 2, 3, 4, 5, 6])(
    "lần đọc thứ %i lỗi tạm thời → failed `precheck_failed`; nhà cung cấp chưa bị gọi; nháp mở cho yêu cầu mới [F-006/AC-08]",
    async (k) => {
      const { svc, seen } = worker({ select: (n) => n === k });
      const draftId = await e.draft();
      const a = await e.actions.requestSend({
        ...M(),
        draftId,
        idempotencyKey: "k1",
      });
      expect(await svc.dispatch({ actionId: a.id })).toEqual({
        status: "failed",
      });
      expect(seen.injected).toBe(1);
      expect(await row(a.id)).toMatchObject({
        state: "failed",
        errorCode: "precheck_failed",
        attempts: 1,
      });
      expect(e.send).not.toHaveBeenCalled();
      expect(await draftStatus(draftId)).toBe("open");
      const again = await e.actions.requestSend({
        ...M(),
        draftId,
        idempotencyKey: "k2",
      });
      expect(await e.actions.dispatch({ actionId: again.id })).toEqual({
        status: "sent",
      });
      expect(e.send).toHaveBeenCalledTimes(1);
    },
  );

  it("CSDL sập hẳn sau khi nhận việc (đọc lẫn ghi kết quả đều lỗi): dòng kẹt dispatching, quá ngưỡng thì gỡ thành send_unknown; không gửi", async () => {
    const { svc } = worker({ select: () => true, update: (n) => n > 1 });
    const a = await e.actions.requestSend({
      ...M(),
      draftId: await e.draft(),
      idempotencyKey: "k1",
    });
    await expect(svc.dispatch({ actionId: a.id })).rejects.toThrow(
      /Connection terminated/,
    );
    expect((await row(a.id)).state).toBe("dispatching");
    expect(e.send).not.toHaveBeenCalled();
    e.state.now = at(STUCK);
    expect(await recover()).toBe(1);
    expect(await row(a.id)).toMatchObject({
      state: "send_unknown",
      errorCode: "interrupted",
    });
    expect(e.send).not.toHaveBeenCalled();
  });

  it("nhà cung cấp ĐÃ nhận tin rồi CSDL lỗi khi ghi kết quả: kẹt dispatching → gỡ → đối soát thấy tin → confirmed", async () => {
    const fault = { on: false };
    const { svc } = worker({ update: () => fault.on });
    e.send.mockImplementationOnce(async () => {
      fault.on = true; // CSDL rớt ngay sau khi nhà cung cấp trả 200
      return { messageIds: ["sapi-1"] };
    });
    const draftId = await e.draft("Dạ còn ạ");
    const a = await e.actions.requestSend({
      ...M(),
      draftId,
      idempotencyKey: "k1",
    });
    await expect(svc.dispatch({ actionId: a.id })).rejects.toThrow(
      /Connection terminated/,
    );
    expect((await row(a.id)).state).toBe("dispatching");
    e.state.now = at(STUCK);
    expect(await recover()).toBe(1);
    e.list.mockResolvedValue({
      items: [outgoing("Dạ còn ạ", at(1_000))],
      nextCursor: null,
    });
    expect(await e.actions.reconcile({ actionId: a.id })).toEqual({
      status: "confirmed",
    });
    expect(await draftStatus(draftId)).toBe("sent");
    expect(e.send).toHaveBeenCalledTimes(1);
  });
});
