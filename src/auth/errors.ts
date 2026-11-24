/** Không đủ quyền (hoặc không phải thành viên: không phân biệt, để khỏi lộ workspace tồn tại hay không). */
export class ForbiddenError extends Error {
  readonly code = "forbidden";
  constructor(message = "Không đủ quyền") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Thử lại quá nhiều lần trong thời gian ngắn (khoá tạm theo tài khoản); người dùng chờ rồi thử lại. */
export class TooManyAttemptsError extends Error {
  readonly code = "too_many_attempts";
  constructor(message = "Thử quá nhiều lần, hãy thử lại sau ít phút") {
    super(message);
    this.name = "TooManyAttemptsError";
  }
}

/** Đầu vào sai; người gọi sửa được. */
export class ValidationError extends Error {
  readonly code = "validation";
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly code = "not_found";
  constructor(message = "Không tìm thấy") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Thao tác hợp lệ về quyền nhưng vi phạm bất biến nghiệp vụ. */
export class ConflictError extends Error {
  readonly code = "conflict";
  constructor(
    readonly reason:
      | "last_owner"
      | "owner_has_members"
      | "already_member"
      | "duplicate_label"
      | "idempotency_conflict"
      | "workspace_limit"
      | "duplicate_account"
      | "project_limit"
      | "name_taken"
      | "alias_limit"
      | "alias_taken"
      | "decision_not_active"
      | "version_conflict"
      | "draft_closed"
      | "draft_send_pending"
      | "action_not_cancellable"
      | "action_not_unknown",
    message: string,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}
