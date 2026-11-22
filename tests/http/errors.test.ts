import { describe, expect, it } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/src/auth/errors";
import { createLogger } from "@/src/log/logger";
import { SocialApiError } from "@/src/providers/socialapi";
import { UnsupportedError, ValidationError } from "@/src/providers/types";
import { handleError } from "@/src/http/errors";

function setup() {
  const lines: string[] = [];
  const log = createLogger({
    service: "t",
    version: "0",
    env: "test",
    write: (l) => lines.push(l),
  });
  return { log, lines };
}

describe("handleError (BASE-ERR-002/003/010)", () => {
  it.each([
    [new ForbiddenError(), 403, "forbidden"],
    [new NotFoundError("x"), 404, "not_found"],
    [new ConflictError("last_owner", "x"), 409, "last_owner"],
    [new ValidationError("Nội dung rỗng"), 422, "validation"],
    [new UnsupportedError("facebook", "reviews"), 422, "unsupported"],
    [
      new UnsupportedError("facebook", "reviews", "not_implemented"),
      501,
      "not_implemented",
    ],
  ])("%s → %i", (err, status, code) => {
    const { log } = setup();
    const r = handleError(err, { log, requestId: "req-1" });
    expect(r.status).toBe(status);
    expect(r.body.error.code).toBe(code);
    expect(r.body.error.request_id).toBe("req-1");
  });

  it("lỗi không biết → 500 chung, KHÔNG lộ thông điệp, stack, đường dẫn, chuỗi kết nối", () => {
    const { log, lines } = setup();
    const err = new Error(
      "connect ECONNREFUSED postgres://app:s3cr3t@10.0.0.5:5432/prod at /srv/app/db.js:12",
    );
    const r = handleError(err, { log, requestId: "req-2" });
    const wire = JSON.stringify(r.body);
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("internal");
    for (const leak of [
      "ECONNREFUSED",
      "s3cr3t",
      "/srv/app",
      "10.0.0.5",
      "at ",
    ]) {
      expect(wire).not.toContain(leak);
    }
    // nhưng log nội bộ có đủ chi tiết (đã che bí mật) để chẩn đoán
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!) as Record<string, string>;
    expect(rec.level).toBe("error");
    expect(rec.request_id).toBe("req-2");
    expect(rec["exception.message"]).toContain("ECONNREFUSED");
    expect(lines[0]).not.toContain("s3cr3t");
  });

  it("lỗi từ nhà cung cấp ngoài → 502 chung, không lộ nội dung phía họ", () => {
    const { log } = setup();
    const r = handleError(
      new SocialApiError("token sk-live-abc hết hạn", 401, "http.401"),
      { log, requestId: "r" },
    );
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain("sk-live");
    expect(r.body.error.code).toBe("upstream_error");
  });

  it("giá trị ném không phải Error cũng thành 500 chung, không ném tiếp", () => {
    const { log } = setup();
    for (const v of ["chuỗi", 42, null, undefined, { a: 1 }]) {
      expect(handleError(v, { log, requestId: "r" }).status).toBe(500);
    }
  });

  it("timeout từ nhà cung cấp → 504", () => {
    const { log } = setup();
    const r = handleError(new SocialApiError("hết giờ", 0, "client.timeout"), {
      log,
      requestId: "r",
    });
    expect(r.status).toBe(504);
    expect(r.body.error.code).toBe("upstream_timeout");
  });
});
