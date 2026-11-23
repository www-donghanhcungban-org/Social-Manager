import { ConflictError, ForbiddenError, NotFoundError } from "../auth/errors";
import type { Logger } from "../log/logger";
import { SocialApiError } from "../providers/socialapi";
import { UnsupportedError, ValidationError } from "../providers/types";

export interface ErrorBody {
  error: { code: string; message: string; request_id: string };
}

export interface HttpErrorResult {
  status: number;
  body: ErrorBody;
}

/**
 * Điểm duy nhất đổi lỗi thành phản hồi HTTP (BASE-ERR-002/003/010).
 * - Lỗi nghiệp vụ đã biết: mã + thông điệp tĩnh do mình viết.
 * - Mọi thứ còn lại (kể cả giá trị ném không phải Error): 500 chung, thất bại đóng. Chi tiết chỉ vào log
 *   nội bộ (đã che bí mật), không bao giờ ra phản hồi: không stack, đường dẫn, phiên bản, chuỗi kết nối.
 * - Lỗi từ nhà cung cấp ngoài: 502/504 chung, không chuyển tiếp nội dung phía họ.
 */
export function handleError(
  err: unknown,
  ctx: { log: Logger; requestId: string },
): HttpErrorResult {
  const known = classify(err);
  if (known.logLevel) {
    ctx.log[known.logLevel]("request failed", {
      request_id: ctx.requestId,
      error: err,
    });
  }
  return {
    status: known.status,
    body: {
      error: {
        code: known.code,
        message: known.message,
        request_id: ctx.requestId,
      },
    },
  };
}

interface Classified {
  status: number;
  code: string;
  message: string;
  logLevel?: "warn" | "error";
}

function classify(err: unknown): Classified {
  if (err instanceof ForbiddenError)
    return { status: 403, code: "forbidden", message: err.message };
  if (err instanceof NotFoundError)
    return { status: 404, code: "not_found", message: err.message };
  if (err instanceof ConflictError)
    return { status: 409, code: err.reason, message: err.message };
  if (err instanceof ValidationError)
    return { status: 422, code: "validation", message: err.message };
  if (err instanceof UnsupportedError) {
    return err.code === "not_implemented"
      ? {
          status: 501,
          code: "not_implemented",
          message: "Tính năng này chưa được cài đặt cho nguồn dữ liệu đã chọn",
        }
      : {
          status: 422,
          code: "unsupported",
          message: "Nguồn dữ liệu đã chọn không hỗ trợ tính năng này",
        };
  }
  if (err instanceof SocialApiError) {
    return err.code === "client.timeout"
      ? {
          status: 504,
          code: "upstream_timeout",
          message: "Nhà cung cấp dữ liệu không phản hồi kịp",
          logLevel: "warn",
        }
      : {
          status: 502,
          code: "upstream_error",
          message: "Nhà cung cấp dữ liệu trả lỗi",
          logLevel: "warn",
        };
  }
  return {
    status: 500,
    code: "internal",
    message:
      "Có lỗi xảy ra. Hãy thử lại hoặc báo mã yêu cầu cho quản trị viên.",
    logLevel: "error",
  };
}
