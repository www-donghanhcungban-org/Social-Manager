import { describe, expect, it } from "vitest";

import { ACTIONS, can, type Action } from "@/src/auth/permissions";

const allowed = (role: "owner" | "admin" | "member" | null) =>
  ACTIONS.filter((a) => can(role, a)).sort();

describe("can", () => {
  it("member chỉ đọc/trả lời hộp thư và đăng bài", () => {
    expect(allowed("member")).toEqual(
      ["inbox.read", "inbox.reply", "posts.publish"].sort(),
    );
  });

  it("admin thêm: quản lý kết nối, mời và xoá thành viên", () => {
    expect(allowed("admin")).toEqual(
      [
        "inbox.read",
        "inbox.reply",
        "posts.publish",
        "connections.manage",
        "members.invite",
        "members.remove",
      ].sort(),
    );
  });

  it("chỉ owner đổi vai trò và xoá workspace; owner làm được mọi việc", () => {
    expect(allowed("owner")).toEqual([...ACTIONS].sort());
    for (const a of ["members.changeRole", "workspace.delete"] as Action[]) {
      expect(can("admin", a)).toBe(false);
      expect(can("member", a)).toBe(false);
    }
  });

  it("người ngoài workspace (null) không làm được gì", () => {
    expect(allowed(null)).toEqual([]);
  });
});
