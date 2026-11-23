import { describe, expect, it } from "vitest";

import {
  SOURCE_LABEL,
  UNANSWERED_LABEL,
  describeAskError,
} from "@/src/ai/labels";
import { AiDisabledError, AiNotAllowedError, ModelError } from "@/src/ai/port";
import { ForbiddenError, NotFoundError } from "@/src/auth/errors";
import { EVIDENCE_SOURCES } from "@/src/db/schema";
import { ValidationError } from "@/src/providers/types";

describe("nhãn hỏi đáp", () => {
  it("mọi nguồn bằng chứng và lý do không trả lời được đều có nhãn", () => {
    expect(Object.keys(SOURCE_LABEL).sort()).toEqual(
      [...EVIDENCE_SOURCES].sort(),
    );
    expect(Object.keys(UNANSWERED_LABEL).sort()).toEqual([
      "insufficient",
      "invalid_output",
      "no_evidence",
    ]);
  });
});

describe("describeAskError", () => {
  it("phân loại lỗi người dùng gặp được", () => {
    expect(describeAskError(new AiDisabledError())).toMatch(/chưa được bật/);
    expect(describeAskError(new AiNotAllowedError())).toMatch(/đám mây/);
    expect(describeAskError(new ForbiddenError())).toMatch(/không có quyền/);
    expect(describeAskError(new NotFoundError())).toMatch(/Không tìm thấy/);
    expect(describeAskError(new ValidationError("Câu hỏi rỗng"))).toBe(
      "Câu hỏi rỗng",
    );
  });

  it("lỗi mô hình: chậm khác lỗi chung; không in mã hay nội dung lỗi", () => {
    expect(describeAskError(new ModelError("model.timeout", "x"))).toMatch(
      /quá chậm/,
    );
    const other = describeAskError(
      new ModelError("model.http.500", "sk-live-abc"),
    );
    expect(other).toMatch(/Không gọi được/);
    expect(other).not.toMatch(/500|sk-live/);
  });

  it("lỗi lạ được ném lại", () => {
    expect(() => describeAskError(new Error("db down"))).toThrow("db down");
  });
});
