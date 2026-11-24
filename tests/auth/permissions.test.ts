import { describe, expect, it } from "vitest";

import { ACTIONS, can, type Action } from "@/src/auth/permissions";

const allowed = (role: "owner" | "admin" | "member" | null) =>
  ACTIONS.filter((a) => can(role, a)).sort();

describe("can [F-001/AC-06]", () => {
  it("member chỉ đọc/trả lời hộp thư, đăng bài và đọc kho bằng chứng", () => {
    expect(allowed("member")).toEqual(
      [
        "inbox.read",
        "inbox.reply",
        "posts.publish",
        "evidence.read",
        "projects.read",
      ].sort(),
    );
  });

  it("admin thêm: quản lý kết nối, mời và xoá thành viên", () => {
    expect(allowed("admin")).toEqual(
      [
        "inbox.read",
        "inbox.reply",
        "posts.publish",
        "evidence.read",
        "evidence.write",
        "projects.read",
        "projects.write",
        "data.export",
        "actions.resolve",
        "connections.manage",
        "members.invite",
        "members.remove",
      ].sort(),
    );
  });

  it("chỉ owner đổi vai trò, xoá workspace và đổi cấu hình (thời hạn lưu); owner làm được mọi việc", () => {
    expect(allowed("owner")).toEqual([...ACTIONS].sort());
    for (const a of [
      "members.changeRole",
      "workspace.delete",
      "workspace.settings",
      "data.erase",
    ] as Action[]) {
      expect(can("admin", a)).toBe(false);
      expect(can("member", a)).toBe(false);
    }
  });

  it("người ngoài workspace (null) không làm được gì", () => {
    expect(allowed(null)).toEqual([]);
  });
});
