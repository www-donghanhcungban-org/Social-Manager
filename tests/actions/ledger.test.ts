import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { textHashOf } from "@/src/actions/ledger";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import {
  actionLedger,
  conversations,
  draftVersions,
  drafts,
  messages,
  workspaces,
} from "@/src/db/schema";
import { SocialApiError } from "@/src/providers/socialapi";
import { SendRejectedError, ValidationError } from "@/src/providers/types";
import { createWorkspaceService } from "@/src/workspaces/service";

import { type Env, H, NOW, setup } from "./helpers";

let e: Env;
beforeEach(async () => {
  e = await setup();
});
afterEach(async () => {
  await e.t.client.close();
});

const M = () => ({ actorId: "member", workspaceId: e.ws });
const request = (draftId: string, key = "k1", actorId = "member") =>
  e.actions.requestSend({
    actorId,
    workspaceId: e.ws,
    draftId,
    idempotencyKey: key,
  });
const rows = () => e.t.db.select().from(actionLedger);

describe("yêu cầu gửi và chính sách", () => {
  it("đủ điều kiện: xếp hàng (chưa gọi nhà cung cấp); dòng sổ có băm, người nhận suy ra từ hội thoại, không có nội dung", async () => {
    const d = await e.draft("Dạ còn ạ");
    const a = await request(d);
    expect(a).toMatchObject({
      state: "queued",
      created: true,
      draftId: d,
      draftVersion: 1,
      attempts: 0,
    });
    expect(e.send).not.toHaveBeenCalled();
    const [row] = await rows();
    expect(row).toMatchObject({
      recipientRef: "conv-1",
      textHash: textHashOf("Dạ còn ạ"),
      textBytes: Buffer.byteLength("Dạ còn ạ"),
      conversationId: e.conv,
    });
    expect(JSON.stringify(row)).not.toContain("Dạ còn ạ");
  });

  it.each([
    [
      "cờ hệ thống tắt",
      async () => {
        e.state.live = false;
      },
      "outbound_disabled",
    ],
    [
      "workspace chưa bật",
      async () => {
        await e.t.db.update(workspaces).set({ outboundEnabled: false });
      },
      "policy_disabled",
    ],
    [
      "hết cửa sổ nhắn tin",
      async () => {
        e.state.now = new Date(NOW.getTime() + 25 * H);
      },
      "window_closed",
    ],
    [
      "chưa có tin đến",
      async () => {
        await e.t.db.delete(messages);
      },
      "no_incoming_message",
    ],
    [
      "hạn mức bằng 0",
      async () => {
        await e.t.db.update(workspaces).set({ outboundMaxPerHour: 0 });
      },
      "rate_limited",
    ],
  ] as const)(
    "%s → ghi dòng blocked kèm lý do, không xếp hàng",
    async (_n, arrange, reason) => {
      const d = await e.draft();
      await arrange();
      const a = await request(d);
      expect(a).toMatchObject({ state: "blocked", blockedReason: reason });
      expect(a.finishedAt).not.toBeNull();
      expect(e.send).not.toHaveBeenCalled();
    },
  );

  it("nội dung quá dài so với nền tảng (Facebook 2000 ký tự) bị chặn text_too_long", async () => {
    const d = await e.draft("x".repeat(2001));
    expect(await request(d)).toMatchObject({
      state: "blocked",
      blockedReason: "text_too_long",
    });
  });

  it("hạn mức giờ: đúng biên; hành động bị chặn không tính vào hạn mức; qua giờ thì hết tính", async () => {
    await e.t.db.update(workspaces).set({ outboundMaxPerHour: 2 });
    const ids = [await e.draft("a"), await e.draft("b"), await e.draft("c")];
    expect((await request(ids[0]!, "k-a")).state).toBe("queued");
    expect((await request(ids[1]!, "k-b")).state).toBe("queued");
    expect(await request(ids[2]!, "k-c")).toMatchObject({
      state: "blocked",
      blockedReason: "rate_limited",
    });
    // sau 1 giờ + 1 phút: hai hành động cũ rơi khỏi cửa sổ
    e.state.now = new Date(NOW.getTime() + H + 60_000);
    await e.addMessage({ sentAt: e.state.now });
    expect((await request(ids[2]!, "k-c2")).state).toBe("queued");
  });

  it("nháp lạ/workspace khác là NotFound; nháp đã bỏ là draft_closed; khoá rỗng hoặc quá dài bị từ chối; người ngoài Forbidden", async () => {
    const d = await e.draft();
    await expect(request("lạ")).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      request("00000000-0000-4000-8000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
    for (const key of ["", "k".repeat(129)])
      await expect(request(d, key)).rejects.toBeInstanceOf(ValidationError);
    await expect(request(d, "k", "lạ")).rejects.toBeInstanceOf(ForbiddenError);
    await e.drafts.discard({ ...M(), draftId: d });
    await expect(request(d, "k2")).rejects.toMatchObject({
      reason: "draft_closed",
    });
    expect(await rows()).toHaveLength(0);
  });
});

describe("lũy đẳng", () => {
  it("gửi lại cùng khoá trả cùng hành động, không tạo thứ hai; vẫn đúng sau khi đã gửi xong", async () => {
    const d = await e.draft();
    const a = await request(d, "same");
    const again = await request(d, "same");
    expect(again).toMatchObject({ id: a.id, created: false });
    await e.actions.dispatch({ actionId: a.id });
    const after = await request(d, "same");
    expect(after).toMatchObject({
      id: a.id,
      state: "confirmed",
      created: false,
    });
    expect(await rows()).toHaveLength(1);
  });

  it("cùng khoá cho nháp khác là xung đột; khoá khác cho nháp đang có hành động hiệu lực cũng bị từ chối", async () => {
    const d1 = await e.draft("một");
    const d2 = await e.draft("hai");
    await request(d1, "k");
    await expect(request(d2, "k")).rejects.toMatchObject({
      reason: "idempotency_conflict",
    });
    await expect(request(d1, "k-khac")).rejects.toMatchObject({
      reason: "idempotency_conflict",
    });
    expect(await rows()).toHaveLength(1);
  });

  it("hai yêu cầu song song cùng khoá chỉ tạo một dòng", async () => {
    const d = await e.draft();
    const [a, b] = await Promise.all([request(d, "race"), request(d, "race")]);
    expect(a.id).toBe(b.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("sau khi bị chặn hoặc thất bại, cùng nháp yêu cầu lại với khoá MỚI được", async () => {
    const d = await e.draft();
    e.state.live = false;
    expect((await request(d, "k1")).state).toBe("blocked");
    e.state.live = true;
    const a2 = await request(d, "k2");
    expect(a2.state).toBe("queued");
    e.send.mockRejectedValueOnce(new SendRejectedError("http.400", "rejected"));
    await e.actions.dispatch({ actionId: a2.id });
    expect((await e.actions.get({ ...M(), actionId: a2.id })).state).toBe(
      "failed",
    );
    expect((await request(d, "k3")).state).toBe("queued");
  });
});

describe("gửi đúng một lần", () => {
  it("dispatch gọi nhà cung cấp một lần với đúng tài khoản, hội thoại, nội dung; confirmed + nháp thành sent", async () => {
    const d = await e.draft("Dạ còn ạ");
    const a = await request(d);
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "sent",
    });
    expect(e.send).toHaveBeenCalledTimes(1);
    expect(e.send).toHaveBeenCalledWith({
      platform: "facebook",
      accountId: "page-1",
      conversationId: "conv-1",
      text: "Dạ còn ạ",
    });
    const got = await e.actions.get({ ...M(), actionId: a.id });
    expect(got).toMatchObject({
      state: "confirmed",
      providerMessageIds: ["sapi-1"],
      attempts: 1,
      errorCode: null,
    });
    expect(got.dispatchedAt).toEqual(NOW);
    expect(got.finishedAt).toEqual(NOW);
    const [draft] = await e.t.db.select().from(drafts).where(eq(drafts.id, d));
    expect(draft!.status).toBe("sent");
  });

  it("gọi dispatch lần hai cho hành động đã xong bị bỏ qua, không gửi lại", async () => {
    const a = await request(await e.draft());
    await e.actions.dispatch({ actionId: a.id });
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "skipped",
    });
    expect(
      await e.actions.dispatch({
        actionId: "00000000-0000-4000-8000-000000000000",
      }),
    ).toEqual({ status: "skipped" });
    expect(e.send).toHaveBeenCalledTimes(1);
  });

  it("hai dispatch song song: chỉ một thắng, nhà cung cấp chỉ bị gọi một lần", async () => {
    const a = await request(await e.draft());
    e.send.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { messageIds: ["x"] };
    });
    const results = await Promise.all([
      e.actions.dispatch({ actionId: a.id }),
      e.actions.dispatch({ actionId: a.id }),
      e.actions.dispatch({ actionId: a.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "sent",
      "skipped",
      "skipped",
    ]);
    expect(e.send).toHaveBeenCalledTimes(1);
    expect((await rows())[0]!.attempts).toBe(1);
  });

  it("Zalo trả id rỗng vẫn confirmed với danh sách id rỗng", async () => {
    e.send.mockResolvedValueOnce({ messageIds: [] });
    const a = await request(await e.draft());
    await e.actions.dispatch({ actionId: a.id });
    expect(await e.actions.get({ ...M(), actionId: a.id })).toMatchObject({
      state: "confirmed",
      providerMessageIds: [],
    });
  });
});

describe("kết quả của nhà cung cấp", () => {
  const run = async () => {
    const a = await request(await e.draft());
    const r = await e.actions.dispatch({ actionId: a.id });
    return { r, got: await e.actions.get({ ...M(), actionId: a.id }) };
  };

  it("từ chối chắc chắn → failed với mã an toàn; nháp vẫn mở", async () => {
    e.send.mockRejectedValueOnce(new SendRejectedError("http.422", "rejected"));
    const { r, got } = await run();
    expect(r.status).toBe("failed");
    expect(got).toMatchObject({
      state: "failed",
      errorCode: "http.422",
      attempts: 1,
    });
    const [d] = await e.t.db.select().from(drafts);
    expect(d!.status).toBe("open");
  });

  it("nhà cung cấp báo hết cửa sổ → blocked window_closed (không phải lỗi để thử lại)", async () => {
    e.send.mockRejectedValueOnce(
      new SendRejectedError("messaging_window_closed", "window_closed"),
    );
    const { r, got } = await run();
    expect(r.status).toBe("blocked");
    expect(got).toMatchObject({
      state: "blocked",
      blockedReason: "window_closed",
    });
  });

  it.each([
    ["5xx", () => new SocialApiError("x", 502, "http.502"), "http.502"],
    [
      "hết giờ",
      () => new SocialApiError("x", 0, "client.timeout"),
      "client.timeout",
    ],
    [
      "mất kết nối",
      () => new SocialApiError("x", 0, "client.network"),
      "client.network",
    ],
    [
      "phản hồi sai hình dạng",
      () => new SocialApiError("x", 200, "client.invalid_response"),
      "client.invalid_response",
    ],
    [
      "lỗi lạ có nội dung nhạy cảm",
      () => new Error("postgres://u:pw@h/db sk-live-x"),
      "internal",
    ],
  ])("%s → send_unknown, mã an toàn, KHÔNG gửi lại", async (_n, make, code) => {
    e.send.mockRejectedValueOnce(make());
    const a = await request(await e.draft());
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "send_unknown",
    });
    const got = await e.actions.get({ ...M(), actionId: a.id });
    expect(got).toMatchObject({
      state: "send_unknown",
      errorCode: code,
      attempts: 1,
    });
    expect(JSON.stringify(got)).not.toMatch(/pw@|sk-live/);
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "skipped",
    });
    expect(e.send).toHaveBeenCalledTimes(1);
    // nháp còn bị khoá bởi hành động chưa rõ: không yêu cầu gửi lại bằng khoá khác
    await expect(request(a.draftId!, "k-moi")).rejects.toMatchObject({
      reason: "idempotency_conflict",
    });
  });

  it("nhà cung cấp không cài sendMessage → failed not_implemented (chắc chắn chưa gửi)", async () => {
    e.state.provider = {
      id: "fake",
      label: "f",
      support: { facebook: ["dm"] },
    };
    const { r, got } = await run();
    expect(r.status).toBe("failed");
    expect(got.errorCode).toBe("not_implemented");
  });

  it("nhà cung cấp không còn đăng ký → failed provider_unavailable", async () => {
    e.state.provider = undefined;
    const { got } = await run();
    expect(got).toMatchObject({
      state: "failed",
      errorCode: "provider_unavailable",
    });
    expect(e.send).not.toHaveBeenCalled();
  });
});

describe("kiểm lại trước khi gửi", () => {
  it("cờ hệ thống tắt giữa chừng: giữ nguyên hàng đợi (deferred), bật lại thì gửi", async () => {
    const a = await request(await e.draft());
    e.state.live = false;
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "deferred",
    });
    expect((await e.actions.get({ ...M(), actionId: a.id })).state).toBe(
      "queued",
    );
    expect(e.send).not.toHaveBeenCalled();
    e.state.live = true;
    expect((await e.actions.dispatch({ actionId: a.id })).status).toBe("sent");
  });

  it("owner tắt gửi của workspace sau khi xếp hàng → blocked policy_disabled, không gửi", async () => {
    const a = await request(await e.draft());
    await createWorkspaceService({ db: e.t.db }).setOutbound({
      actorId: "owner",
      workspaceId: e.ws,
      enabled: false,
    });
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "blocked",
    });
    expect(await e.actions.get({ ...M(), actionId: a.id })).toMatchObject({
      blockedReason: "policy_disabled",
    });
    expect(e.send).not.toHaveBeenCalled();
  });

  it("cửa sổ nhắn tin đóng trong lúc chờ → blocked window_closed", async () => {
    const a = await request(await e.draft());
    e.state.now = new Date(NOW.getTime() + 25 * H);
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "blocked",
    });
    expect(await e.actions.get({ ...M(), actionId: a.id })).toMatchObject({
      blockedReason: "window_closed",
    });
    expect(e.send).not.toHaveBeenCalled();
  });

  it("nội dung phiên bản nháp bị đụng vào sau khi duyệt → failed draft_changed, không gửi thứ chưa duyệt", async () => {
    const a = await request(await e.draft("bản đã duyệt"));
    await e.t.db.update(draftVersions).set({ text: "bản bị sửa lén" });
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "failed",
    });
    expect(await e.actions.get({ ...M(), actionId: a.id })).toMatchObject({
      errorCode: "draft_changed",
    });
    expect(e.send).not.toHaveBeenCalled();
  });

  it("sửa nháp sau khi xếp hàng không đổi nội dung sẽ gửi (hành động trỏ phiên bản đã duyệt)", async () => {
    const d = await e.draft("bản một");
    const a = await request(d);
    await e.drafts.edit({
      ...M(),
      draftId: d,
      baseVersion: 1,
      text: "bản hai",
    });
    await e.actions.dispatch({ actionId: a.id });
    expect(e.send.mock.calls[0]![0].text).toBe("bản một");
  });

  it("hội thoại bị xoá sau khi xếp hàng → failed conversation_missing; dấu vết người nhận còn trong sổ", async () => {
    const a = await request(await e.draft());
    await e.t.db.delete(conversations).where(eq(conversations.id, e.conv));
    // xoá hội thoại xoá luôn nháp (cascade) nên phiên bản không còn: lỗi nào đến trước cũng là chắc chắn-chưa-gửi
    expect(await e.actions.dispatch({ actionId: a.id })).toEqual({
      status: "failed",
    });
    const [row] = await rows();
    expect(row).toMatchObject({
      conversationId: null,
      draftId: null,
      recipientRef: "conv-1",
    });
    expect(["draft_missing", "conversation_missing"]).toContain(row!.errorCode);
    expect(e.send).not.toHaveBeenCalled();
  });
});

describe("phạm vi và ràng buộc", () => {
  it("người ngoài không xem được; hành động workspace khác là NotFound; liệt kê theo trạng thái", async () => {
    const a = await request(await e.draft());
    await expect(
      e.actions.get({ actorId: "lạ", workspaceId: e.ws, actionId: a.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      e.actions.get({ ...M(), actionId: "lạ" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await e.actions.list({ ...M() })).map((x) => x.id)).toEqual([a.id]);
    expect(await e.actions.list({ ...M(), state: "confirmed" })).toEqual([]);
  });

  it("CHECK của CSDL: attempts tối đa 1, blocked bắt buộc có lý do, băm sai định dạng bị từ chối", async () => {
    const a = await request(await e.draft());
    for (const set of [
      { attempts: 2 },
      { state: "blocked" as const },
      { textHash: "xyz" },
      { errorCode: "có khoảng trắng và nội dung" },
    ])
      await expect(
        e.t.db.update(actionLedger).set(set).where(eq(actionLedger.id, a.id)),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("xoá hội thoại/nháp giữ sổ (SET NULL); xoá workspace xoá sổ", async () => {
    await request(await e.draft());
    await e.t.db.delete(drafts);
    expect(await rows()).toHaveLength(1);
    await e.t.db.delete(workspaces).where(eq(workspaces.id, e.ws));
    expect(await rows()).toHaveLength(0);
  });

  it("owner đổi chính sách gửi; admin/member không; hạn mức ngoài 0-1000 bị từ chối", async () => {
    const svc = createWorkspaceService({ db: e.t.db });
    expect(await svc.getOutbound({ ...M() })).toEqual({
      enabled: true,
      maxPerHour: 10,
    });
    for (const actorId of ["admin", "member", "lạ"])
      await expect(
        svc.setOutbound({ actorId, workspaceId: e.ws, enabled: false }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await svc.setOutbound({
        actorId: "owner",
        workspaceId: e.ws,
        enabled: true,
        maxPerHour: 1000,
      }),
    ).toEqual({ enabled: true, maxPerHour: 1000 });
    for (const maxPerHour of [-1, 1001, 1.5, Number.NaN])
      await expect(
        svc.setOutbound({
          actorId: "owner",
          workspaceId: e.ws,
          enabled: true,
          maxPerHour,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      svc.setOutbound({
        actorId: "owner",
        workspaceId: e.ws,
        enabled: "có" as never,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(ConflictError).toBeDefined();
  });
});
