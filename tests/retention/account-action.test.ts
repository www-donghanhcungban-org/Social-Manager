import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  TooManyAttemptsError,
} from "@/src/auth/errors";

/**
 * Lớp vỏ Next của quyền chủ thể (trang `/app/account`): Server Action xoá tài khoản và route xuất dữ liệu. Dịch vụ thật
 * đã có test ở `rights.test.ts`; ở đây chỉ thay phiên và container để kiểm phần vỏ: id lấy từ phiên (không từ form),
 * ô xác nhận bắt buộc, lỗi người dùng gặp được thành lời nhắn, chưa đăng nhập thì 401.
 */
const live = vi.hoisted(() => ({
  user: { id: "u-phien", email: "lan@example.com", name: "Lan" } as {
    id: string;
    email: string;
    name: string;
  } | null,
  deleteAccount: vi.fn(),
  exportMyData: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/src/server/runtime", () => ({
  currentUser: async () => live.user,
  requireUser: async () => {
    if (!live.user) throw new Error("REDIRECT:/login");
    return live.user;
  },
  getContainer: () => ({
    services: {
      accountRights: {
        deleteAccount: live.deleteAccount,
        exportMyData: live.exportMyData,
      },
    },
  }),
}));

const { deleteAccountAction } = await import("@/app/app/account/actions");
const { POST } = await import("@/app/app/account/export/route");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const del = (o: Record<string, string>) =>
  deleteAccountAction({ error: null }, form(o));

beforeEach(() => {
  live.user = { id: "u-phien", email: "lan@example.com", name: "Lan" };
  live.deleteAccount.mockReset();
  live.exportMyData.mockReset();
});

describe("Server Action xoá tài khoản", () => {
  it("thiếu ô xác nhận: báo lỗi, không gọi dịch vụ xoá dù mật khẩu đúng [F-009/AC-04]", async () => {
    expect(await del({ password: "mat-khau-du-dai-123" })).toEqual({
      error: "Hãy tích ô xác nhận để xoá tài khoản.",
    });
    expect(await del({ password: "x", confirm: "yes" })).toEqual({
      error: "Hãy tích ô xác nhận để xoá tài khoản.",
    });
    expect(live.deleteAccount).not.toHaveBeenCalled();
  });

  it("id lấy từ phiên, không từ form; thành công thì chuyển về /login [F-009/AC-03]", async () => {
    live.deleteAccount.mockResolvedValueOnce({});
    await expect(
      del({ confirm: "on", password: "mat-khau", userId: "nguoi-khac" }),
    ).rejects.toThrow("REDIRECT:/login");
    expect(live.deleteAccount).toHaveBeenCalledWith({
      userId: "u-phien",
      password: "mat-khau",
    });
  });

  it("sai mật khẩu, bị khoá thử, chủ duy nhất: thành lời nhắn, ở lại trang; lỗi lạ ném lại [F-009/AC-04] [F-009/AC-05] [F-009/AC-06]", async () => {
    live.deleteAccount.mockRejectedValueOnce(new ForbiddenError("x"));
    expect(await del({ confirm: "on", password: "sai" })).toEqual({
      error: "Mật khẩu không đúng.",
    });
    live.deleteAccount.mockRejectedValueOnce(new TooManyAttemptsError());
    expect(await del({ confirm: "on", password: "sai" })).toEqual({
      error: new TooManyAttemptsError().message,
    });
    live.deleteAccount.mockRejectedValueOnce(
      new ConflictError("owner_has_members", "Bạn là chủ duy nhất"),
    );
    expect(await del({ confirm: "on", password: "dung" })).toEqual({
      error: "Bạn là chủ duy nhất",
    });
    live.deleteAccount.mockRejectedValueOnce(new Error("db down"));
    await expect(del({ confirm: "on", password: "dung" })).rejects.toThrow(
      "db down",
    );
  });

  it("chưa đăng nhập: chuyển về /login, không gọi dịch vụ [F-009/AC-04]", async () => {
    live.user = null;
    await expect(del({ confirm: "on", password: "x" })).rejects.toThrow(
      "REDIRECT:/login",
    );
    expect(live.deleteAccount).not.toHaveBeenCalled();
  });
});

describe("route POST /app/account/export", () => {
  it("chưa đăng nhập: 401 JSON, no-store, không đọc dữ liệu [F-009/AC-02]", async () => {
    live.user = null;
    const res = await POST();
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(live.exportMyData).not.toHaveBeenCalled();
  });

  it("đã đăng nhập: tệp JSON tải về của chính người trong phiên, không cache [F-009/AC-01]", async () => {
    live.exportMyData.mockResolvedValueOnce({ profile: { email: "lan@x" } });
    const res = await POST();
    expect(live.exportMyData).toHaveBeenCalledWith({ userId: "u-phien" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="du-lieu-cua-toi.json"',
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(JSON.parse(await res.text())).toEqual({
      profile: { email: "lan@x" },
    });
  });
});
