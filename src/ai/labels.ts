import { ForbiddenError, NotFoundError } from "../auth/errors";
import type { EvidenceSource } from "../db/schema";
import { ValidationError } from "../providers/types";
import { AiDisabledError, AiNotAllowedError, ModelError } from "./port";

/** Lý do không trả lời được (`AnswerResult.reason`); đủ mọi giá trị, có test chống lệch. */
export const UNANSWERED_LABEL = {
  no_evidence: "Không tìm thấy nguồn nào liên quan trong kho bằng chứng.",
  insufficient: "Các nguồn tìm được chưa đủ để trả lời chắc chắn.",
  invalid_output:
    "Mô hình trả về kết quả không hợp lệ nên bị loại, không hiển thị câu trả lời.",
  refused: "Mô hình từ chối trả lời câu hỏi này.",
  blocked_input:
    "Câu hỏi có nội dung không được xử lý tự động (ví dụ yêu cầu đổi luật hoặc lộ lời nhắc); hãy diễn đạt lại.",
  human_required:
    "Câu hỏi thuộc nhóm nhạy cảm (y tế, pháp lý, tài chính cá nhân, trẻ em, an toàn cá nhân): cần người xem xét, hệ thống không trả lời tự động.",
} as const;
export type UnansweredReason = keyof typeof UNANSWERED_LABEL;

export const SOURCE_LABEL: Record<EvidenceSource, string> = {
  message: "Tin nhắn",
  document: "Tài liệu",
  github: "GitHub",
};

/**
 * Lời nhắn cho lỗi người dùng gặp được khi hỏi đáp. Lỗi KHÁC được ném lại: không in nội dung lỗi lạ ra giao diện.
 * `ModelError` chỉ mang mã ngắn nên an toàn để phân loại nhưng cũng không in nguyên mã.
 */
export function describeAskError(e: unknown): string {
  if (e instanceof AiDisabledError)
    return "AI chưa được bật trên máy chủ này, nên chưa hỏi đáp được. Tìm kiếm vẫn dùng bình thường.";
  if (e instanceof AiNotAllowedError)
    return "Workspace chưa cho phép gửi dữ liệu tới AI đám mây. Chủ workspace có thể bật ở phần cài đặt.";
  if (e instanceof ModelError)
    return e.code === "model.timeout"
      ? "Mô hình AI phản hồi quá chậm. Thử lại sau."
      : "Không gọi được mô hình AI. Thử lại sau.";
  if (e instanceof ForbiddenError)
    return "Bạn không có quyền thực hiện thao tác này.";
  if (e instanceof NotFoundError) return "Không tìm thấy mục này.";
  if (e instanceof ValidationError) return e.message;
  throw e;
}
