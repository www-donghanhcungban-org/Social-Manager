/** Không đủ quyền (hoặc không phải thành viên: không phân biệt, để khỏi lộ workspace tồn tại hay không). */
export class ForbiddenError extends Error {
  readonly code = "forbidden";
  constructor(message = "Không đủ quyền") {
    super(message);
    this.name = "ForbiddenError";
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
      | "already_member"
      | "duplicate_label"
      | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "ConflictError";
  }
}
