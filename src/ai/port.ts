/**
 * Cổng mô hình ngôn ngữ (H7): dịch vụ chỉ biết `ModelPort`; thư viện AI/SDK/HTTP nằm trong adapter nên đổi được mà không
 * chạm dịch vụ. Mô hình KHÔNG có công cụ ghi — chỉ nhận chữ, trả chữ (H13): mọi hành động ghi đi qua mã của dự án.
 */
export interface ModelRequest {
  system: string;
  user: string;
  maxOutputTokens?: number;
}

export interface ModelPort {
  readonly id: string;
  readonly model: string;
  /** Điểm cuối nằm trên máy/mạng của người dùng: dữ liệu không ra ngoài. */
  readonly local: boolean;
  /** Tên máy của điểm cuối (không kèm đường dẫn/khoá) để ghi nhật ký. */
  readonly host: string;
  generate(req: ModelRequest): Promise<ModelResponse>;
}

export interface ModelResponse {
  text: string;
  /** Số token nhà cung cấp báo (nếu có) — dùng đo chi phí, không dùng để suy nội dung. */
  usage?: { inputTokens: number; outputTokens: number };
  /** Mô hình thực tế phục vụ (có thể khác mô hình yêu cầu). */
  responseModel?: string;
  /**
   * Lý do dừng nhà cung cấp báo (AI-APP-003): `length` = hết `max_tokens` (đầu ra có thể cụt), `refusal` = mô hình từ
   * chối hoặc bị lọc nội dung. Vắng = nhà cung cấp không báo; dịch vụ vẫn kiểm schema đầu ra bằng mã.
   */
  stopReason?: "stop" | "length" | "refusal" | "other";
}

export type ModelErrorCode =
  | "model.timeout"
  | "model.network"
  | "model.invalid_response"
  | `model.http.${number}`;

/** Lỗi gọi mô hình: chỉ mang mã ngắn — không mang thân phản hồi, URL hay khoá. */
export class ModelError extends Error {
  readonly name = "ModelError";
  constructor(
    readonly code: ModelErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Vượt ngân sách gọi AI của workspace (OPS-COST-004, AI-OBS-003): chặn bằng mã, không bằng lời nhắc. */
export class AiBudgetError extends Error {
  readonly name = "AiBudgetError";
  readonly code = "ai_budget_exceeded";
  constructor() {
    super("Đã hết ngân sách gọi AI của workspace trong 24 giờ qua");
  }
}

/** AI chưa được cấu hình (`AI_BASE_URL` trống). */
export class AiDisabledError extends Error {
  readonly name = "AiDisabledError";
  readonly code = "ai_disabled";
  constructor() {
    super("AI chưa được bật (AI_BASE_URL trống)");
  }
}

/** Điểm cuối đám mây mà workspace chưa cho phép. */
export class AiNotAllowedError extends Error {
  readonly name = "AiNotAllowedError";
  readonly code = "cloud_not_enabled";
  constructor() {
    super("Workspace chưa cho phép gửi dữ liệu tới AI đám mây");
  }
}
