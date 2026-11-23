import { describe, expect, it } from "vitest";

import {
  BLOCK_LABEL,
  STATE_LABEL,
  blockLabel,
  describeActionError,
  errorLabel,
} from "@/src/actions/labels";
import { BLOCK_REASONS } from "@/src/actions/policy";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import { ACTION_STATES } from "@/src/db/schema";
import { ValidationError } from "@/src/providers/types";

describe("nhãn", () => {
  it("mọi trạng thái hành động và mọi lý do chặn đều có nhãn không rỗng (chống lệch khi thêm giá trị mới)", () => {
    for (const s of ACTION_STATES) expect(STATE_LABEL[s], s).toBeTruthy();
    for (const r of BLOCK_REASONS) expect(BLOCK_LABEL[r], r).toBeTruthy();
    expect(Object.keys(STATE_LABEL).sort()).toEqual([...ACTION_STATES].sort());
    expect(Object.keys(BLOCK_LABEL).sort()).toEqual([...BLOCK_REASONS].sort());
  });

  it("mã lạ hoặc null có lời chung, không in lại mã (có thể là chuỗi từ nhà cung cấp)", () => {
    expect(blockLabel(null)).toMatch(/không được chấp nhận/);
    expect(blockLabel("postgres://u:pw@h/db")).not.toMatch(/postgres/);
    expect(errorLabel(null)).toBe("Gửi không thành công.");
    expect(errorLabel("sk-live-abc")).not.toMatch(/sk-live/);
    expect(errorLabel("confirmed_not_sent")).toMatch(/chưa được gửi/);
    // tên thuộc tính của Object.prototype không được coi là mã hợp lệ
    expect(blockLabel("toString")).toMatch(/không được chấp nhận/);
    expect(errorLabel("constructor")).toBe("Gửi không thành công.");
  });
});

describe("describeActionError", () => {
  it("dịch lỗi người dùng gặp được", () => {
    expect(describeActionError(new ForbiddenError())).toMatch(/không có quyền/);
    expect(describeActionError(new NotFoundError())).toMatch(/Không tìm thấy/);
    expect(describeActionError(new ValidationError("Nội dung rỗng"))).toBe(
      "Nội dung rỗng",
    );
    expect(
      describeActionError(new ConflictError("version_conflict", "x")),
    ).toMatch(/Tải lại/);
    expect(describeActionError(new ConflictError("last_owner", "x"))).toMatch(
      /xung đột/,
    );
  });

  it("mọi lý do xung đột của nháp/sổ gửi tin có nhãn riêng, không rơi về lời chung", () => {
    const generic = describeActionError(new ConflictError("last_owner", "x"));
    for (const reason of [
      "version_conflict",
      "draft_closed",
      "draft_send_pending",
      "action_not_cancellable",
      "action_not_unknown",
      "idempotency_conflict",
    ] as const) {
      const label = describeActionError(new ConflictError(reason, "x"));
      expect(label, reason).toBeTruthy();
      expect(label, reason).not.toBe(generic);
    }
    expect(
      describeActionError(new ConflictError("draft_send_pending", "x")),
    ).toMatch(/đang được gửi|chưa rõ/);
  });

  it("lỗi hệ thống trước khi gửi có nhãn nói rõ tin chưa đi", () => {
    expect(errorLabel("precheck_failed")).toMatch(/chưa được gửi/);
  });

  it("lỗi lạ được ném lại, không biến thành lời nhắn", () => {
    expect(() => describeActionError(new Error("db down"))).toThrow("db down");
  });
});
