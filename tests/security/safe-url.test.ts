import { describe, expect, it } from "vitest";

import { safeUrl } from "@/src/security/safe-url";

describe("safeUrl (FE-SEC-002)", () => {
  it("chấp nhận http, https, mailto và trả URL đã chuẩn hoá", () => {
    expect(safeUrl("https://example.com/a?b=1#c")).toBe(
      "https://example.com/a?b=1#c",
    );
    expect(safeUrl("HTTP://Example.COM")).toBe("http://example.com/");
    expect(safeUrl("mailto:a@example.com")).toBe("mailto:a@example.com");
  });

  it("từ chối javascript:, data:, vbscript:, file:, blob: kể cả khi ngụy trang", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " \tjavascript:alert(1)",
      "java\nscript:alert(1)",
      "&#106;avascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://example.com/x",
      "//evil.example.com/x",
      "/relative/path",
      "",
      "   ",
      "https://",
      "ftp://example.com",
    ])
      expect(safeUrl(bad), JSON.stringify(bad)).toBeNull();
  });

  it("từ chối kiểu không phải chuỗi, chuỗi quá dài và URL có thông tin đăng nhập", () => {
    for (const bad of [undefined, null, 1, {}, ["https://example.com"]])
      expect(safeUrl(bad)).toBeNull();
    expect(safeUrl(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
    expect(safeUrl("https://user:pw@example.com/")).toBeNull();
  });
});
