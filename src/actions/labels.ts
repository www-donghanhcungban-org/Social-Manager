import { ConflictError, ForbiddenError, NotFoundError } from "../auth/errors";
import type { ActionState } from "../db/schema";
import { ValidationError } from "../providers/types";
import type { BlockReason } from "./policy";

/** Trạng thái hành động gửi, nói cho người dùng (đủ mọi giá trị: có test chống lệch). */
export const STATE_LABEL: Record<ActionState, string> = {
  queued: "Đang chờ gửi",
  dispatching: "Đang gửi",
  confirmed: "Đã gửi",
  send_unknown: "Chưa rõ đã gửi hay chưa",
  blocked: "Bị chặn, chưa gửi",
  failed: "Gửi không được",
  cancel_requested: "Đã yêu cầu huỷ (tin có thể đã đi)",
  cancelled: "Đã huỷ",
};

/** Vì sao một yêu cầu gửi bị chặn (mã của chính sách gửi). */
export const BLOCK_LABEL: Record<BlockReason, string> = {
  outbound_disabled: "Gửi tin đang tắt trên toàn hệ thống.",
  policy_disabled: "Chủ workspace chưa bật gửi tin.",
  no_incoming_message: "Hội thoại chưa có tin đến nào để trả lời.",
  window_closed: "Đã quá cửa sổ nhắn tin của nền tảng, không thể gửi nữa.",
  text_too_long: "Nội dung vượt giới hạn độ dài của nền tảng.",
  rate_limited: "Đã đạt hạn mức gửi trong giờ này, thử lại sau.",
};

/** Mã lỗi ghi ở hành động `failed`; mã lạ (từ nhà cung cấp) chỉ hiện lời chung, không lộ chi tiết. */
const ERROR_LABEL: Record<string, string> = {
  draft_changed: "Nội dung nháp đã đổi sau khi yêu cầu gửi.",
  confirmed_not_sent: "Người quản trị xác nhận tin chưa được gửi.",
  provider_declined: "Nhà cung cấp từ chối gửi tin.",
  window_closed: "Đã quá cửa sổ nhắn tin của nền tảng.",
  precheck_failed:
    "Lỗi hệ thống khi kiểm tra trước khi gửi; tin chưa được gửi. Có thể yêu cầu gửi lại.",
};

export const blockLabel = (reason: string | null): string =>
  reason !== null && Object.hasOwn(BLOCK_LABEL, reason)
    ? BLOCK_LABEL[reason as BlockReason]
    : "Yêu cầu gửi không được chấp nhận.";

export const errorLabel = (code: string | null): string =>
  code !== null && Object.hasOwn(ERROR_LABEL, code)
    ? ERROR_LABEL[code]!
    : "Gửi không thành công.";

const CONFLICT_LABEL: Partial<Record<ConflictError["reason"], string>> = {
  alias_taken: "Bí danh đã trùng với tên hoặc bí danh trong workspace.",
  alias_limit: "Dự án đã đạt số lượng bí danh tối đa.",
  version_conflict: "Nháp vừa được người khác sửa. Tải lại rồi sửa tiếp.",
  draft_closed: "Nháp này đã đóng (đã gửi hoặc đã bỏ).",
  draft_send_pending:
    "Nháp đang được gửi hoặc chưa rõ đã gửi hay chưa nên chưa bỏ được. Chờ kết quả hoặc nhờ quản trị xác nhận.",
  action_not_cancellable: "Hành động này không còn huỷ được.",
  action_not_unknown: "Hành động này không ở trạng thái chưa rõ.",
  idempotency_conflict:
    "Khoá yêu cầu đã dùng cho nội dung khác. Tải lại trang.",
};

/**
 * Lời nhắn cho lỗi người dùng gây ra hoặc gặp được. Lỗi KHÁC (hạ tầng, bug) được ném lại để lớp trên ghi log và hiện trang
 * lỗi chung — không bao giờ in nội dung lỗi lạ ra giao diện.
 */
export function describeActionError(e: unknown): string {
  if (e instanceof ForbiddenError)
    return "Bạn không có quyền thực hiện thao tác này.";
  if (e instanceof NotFoundError) return "Không tìm thấy mục này.";
  if (e instanceof ValidationError) return e.message;
  if (e instanceof ConflictError)
    return (
      CONFLICT_LABEL[e.reason] ?? "Thao tác xung đột với trạng thái hiện tại."
    );
  throw e;
}
