import { describe, expect, it } from "vitest";

import { isCrossSiteMutation } from "@/src/security/csrf";

const h = (o: Record<string, string>) => new Headers(o);

describe("isCrossSiteMutation (SEC-WEB-007)", () => {
  it("method an toàn không bị chặn", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        isCrossSiteMutation(m, h({ "sec-fetch-site": "cross-site" })),
      ).toBe(false);
    }
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "post"])(
    "%s với Sec-Fetch-Site cross-site/same-site bị chặn",
    (m) => {
      expect(
        isCrossSiteMutation(m, h({ "sec-fetch-site": "cross-site" })),
      ).toBe(true);
      expect(isCrossSiteMutation(m, h({ "sec-fetch-site": "same-site" }))).toBe(
        true,
      );
    },
  );

  it("same-origin và none (gõ URL/form trực tiếp) được qua", () => {
    for (const v of ["same-origin", "none"]) {
      expect(
        isCrossSiteMutation("POST", h({ "sec-fetch-site": v, host: "a.test" })),
      ).toBe(false);
    }
  });

  it("không có Sec-Fetch-Site: so Origin với Host", () => {
    expect(
      isCrossSiteMutation(
        "POST",
        h({ origin: "https://a.test", host: "a.test" }),
      ),
    ).toBe(false);
    expect(
      isCrossSiteMutation(
        "POST",
        h({ origin: "https://evil.test", host: "a.test" }),
      ),
    ).toBe(true);
    // Origin rác hoặc "null" (iframe sandbox) → chặn
    for (const o of ["null", "not a url", ""]) {
      expect(
        isCrossSiteMutation("POST", h({ origin: o, host: "a.test" })),
      ).toBe(true);
    }
  });

  it("Origin khớp host nhưng khác cổng → chặn", () => {
    expect(
      isCrossSiteMutation(
        "POST",
        h({ origin: "https://a.test:8443", host: "a.test" }),
      ),
    ).toBe(true);
  });

  it("không có cả hai: chặn nếu mang cookie, cho qua nếu không (client không phải trình duyệt)", () => {
    expect(isCrossSiteMutation("POST", h({ cookie: "s=1" }))).toBe(true);
    expect(isCrossSiteMutation("POST", h({}))).toBe(false);
  });
});
