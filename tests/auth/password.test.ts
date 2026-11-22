import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/src/auth/password";

describe("không băm mật khẩu bằng hàm băm nhanh (BE-AUTH-001)", () => {
  it("src/ không dùng md5/sha1/sha256 để băm", () => {
    const files = execFileSync("git", ["ls-files", "src"], {
      encoding: "utf-8",
    })
      .split("\n")
      .filter((f) => f.endsWith(".ts"));
    const FAST_HASH = /createHash\(\s*["'](md5|sha-?1|sha-?256)["']/i;
    // Miễn hẹp có lý do (ADR-0004): kho bằng chứng định địa chỉ NỘI DUNG bằng sha256 — không phải băm mật khẩu/khoá.
    const CONTENT_ADDRESSING = /^src\/evidence\//;
    const hits = files.filter(
      (f) =>
        !CONTENT_ADDRESSING.test(f) && FAST_HASH.test(readFileSync(f, "utf-8")),
    );
    expect(hits).toEqual([]);
  });

  it("miễn của kho bằng chứng chỉ cho sha256 và không chạm mật khẩu/bí mật", () => {
    const files = execFileSync("git", ["ls-files", "src/evidence"], {
      encoding: "utf-8",
    })
      .split("\n")
      .filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const code = readFileSync(f, "utf-8");
      expect(code, f).not.toMatch(/createHash\(\s*["'](md5|sha-?1)["']/i);
      expect(code, f).not.toMatch(/password|passwd|secret|credential|token/i);
    }
  });
});

describe("băm mật khẩu Argon2id (BE-AUTH-001)", () => {
  it("hash là chuỗi PHC argon2id với tham số ≥ OWASP (m=19456, t=2, p=1)", async () => {
    const h = await hashPassword("mat-khau-du-dai-123");
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(h).not.toContain("mat-khau-du-dai-123");
  });

  it("cùng mật khẩu cho hash khác nhau (salt ngẫu nhiên)", async () => {
    const [a, b] = await Promise.all([
      hashPassword("mat-khau-du-dai-123"),
      hashPassword("mat-khau-du-dai-123"),
    ]);
    expect(a).not.toBe(b);
  });

  it("verify đúng/sai và không ném lỗi với hash rác", async () => {
    const h = await hashPassword("mat-khau-du-dai-123");
    expect(
      await verifyPassword({ hash: h, password: "mat-khau-du-dai-123" }),
    ).toBe(true);
    expect(
      await verifyPassword({ hash: h, password: "sai-mat-khau-xxx" }),
    ).toBe(false);
    for (const bad of ["", "rác", "$argon2id$", "a:b"]) {
      expect(
        await verifyPassword({ hash: bad, password: "mat-khau-du-dai-123" }),
      ).toBe(false);
    }
  });

  it("mật khẩu Unicode (NFC/NFD) và dài > 72 byte đều phân biệt được", async () => {
    const nfc = "Mật khẩu tiếng Việt rất dài 🇻🇳".normalize("NFC");
    const h = await hashPassword(nfc);
    expect(await verifyPassword({ hash: h, password: nfc })).toBe(true);
    // Cùng chuỗi dạng NFD vẫn khớp: chuẩn hoá trước khi băm để gõ trên máy khác không bị khoá.
    expect(
      await verifyPassword({ hash: h, password: nfc.normalize("NFD") }),
    ).toBe(true);
    const long = "x".repeat(100);
    const hl = await hashPassword(long);
    expect(await verifyPassword({ hash: hl, password: long + "y" })).toBe(
      false,
    );
  });
});
