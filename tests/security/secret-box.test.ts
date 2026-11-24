import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createSecretBox,
  isValidMasterKey,
  secretBoxFromEnv,
} from "@/src/security/secret-box";

const key = () => randomBytes(32).toString("base64");

describe("createSecretBox", () => {
  it("mã hoá rồi giải mã trả đúng bản rõ, kể cả tiếng Việt, emoji và chuỗi rỗng", () => {
    const box = createSecretBox(key());
    for (const s of ["sk-abc123", "Khoá bí mật 🔑 ạ", "", "a".repeat(10_000)]) {
      expect(box.decrypt(box.encrypt(s))).toBe(s);
    }
  });

  it("cùng bản rõ mã hoá hai lần cho hai bản mã khác nhau (IV ngẫu nhiên)", () => {
    const box = createSecretBox(key());
    expect(box.encrypt("x")).not.toBe(box.encrypt("x"));
  });

  it("bản mã không chứa bản rõ và có tiền tố phiên bản v1: [F-002/AC-01]", () => {
    const box = createSecretBox(key());
    const token = box.encrypt("sk-rat-bi-mat");
    expect(token.startsWith("v1:")).toBe(true);
    expect(token).not.toContain("sk-rat-bi-mat");
  });

  it("sửa 1 byte của bản mã (kể cả thẻ xác thực) thì giải mã lỗi [F-002/AC-09]", () => {
    const box = createSecretBox(key());
    const token = box.encrypt("du-lieu");
    const raw = Buffer.from(token.slice(3), "base64url");
    for (const pos of [0, 12, raw.length - 1]) {
      const bad = Buffer.from(raw);
      bad[pos] = (bad[pos] ?? 0) ^ 0x01;
      expect(() => box.decrypt(`v1:${bad.toString("base64url")}`)).toThrow(
        /giải mã/,
      );
    }
  });

  it("sai khoá thì giải mã lỗi, không trả rác [F-002/AC-09]", () => {
    const token = createSecretBox(key()).encrypt("du-lieu");
    expect(() => createSecretBox(key()).decrypt(token)).toThrow(/giải mã/);
  });

  it("từ chối token sai định dạng, cắt cụt, hoặc phiên bản lạ", () => {
    const box = createSecretBox(key());
    const good = box.encrypt("x");
    for (const bad of [
      "",
      "v1:",
      "v1:abc",
      "v2:" + good.slice(3),
      "không phải token",
      good.slice(0, 10),
    ]) {
      expect(() => box.decrypt(bad)).toThrow(/giải mã/);
    }
  });

  it("từ chối khoá sai độ dài hoặc không phải base64, thông báo không lộ khoá", () => {
    for (const bad of [
      "",
      "abc",
      randomBytes(16).toString("base64"),
      randomBytes(33).toString("base64"),
    ]) {
      expect(() => createSecretBox(bad)).toThrow(/32 byte/);
    }
    const secretLooking = "khoa-sai-do-dai-bi-mat";
    try {
      createSecretBox(secretLooking);
    } catch (e) {
      expect((e as Error).message).not.toContain(secretLooking);
    }
  });
});

describe("khoá chủ phải đúng base64 chuẩn (review 🟡 7)", () => {
  const notKeys = [
    "this-is-my-very-own-password-for-the-app-42", // mật khẩu thường
    "a".repeat(43), // thiếu đệm
    `${key().slice(0, 43)}`, // bỏ dấu `=`
    ` ${key()}`, // khoảng trắng đầu
    `${key()}\n`, // xuống dòng cuối
    key().replace(/[+/]/g, "-") + "x", // sai ký tự và độ dài
  ];
  it.each(notKeys)("từ chối %j", (bad) => {
    expect(() => createSecretBox(bad)).toThrow(/base64/);
  });
  it("nhận khoá chuẩn do randomBytes(32) sinh ra", () => {
    for (let i = 0; i < 50; i++)
      expect(() => createSecretBox(key())).not.toThrow();
  });
  it("isValidMasterKey trùng hành vi với createSecretBox", () => {
    expect(isValidMasterKey(key())).toBe(true);
    for (const bad of notKeys) expect(isValidMasterKey(bad)).toBe(false);
  });
});

describe("secretBoxFromEnv", () => {
  it("đọc khoá từ APP_SECRET_KEY", () => {
    const box = secretBoxFromEnv({ APP_SECRET_KEY: key() });
    expect(box.decrypt(box.encrypt("ok"))).toBe("ok");
  });

  it("thiếu biến môi trường thì lỗi nói rõ tên biến, không dùng khoá mặc định", () => {
    expect(() => secretBoxFromEnv({})).toThrow(/APP_SECRET_KEY/);
    expect(() => secretBoxFromEnv({ APP_SECRET_KEY: "" })).toThrow(
      /APP_SECRET_KEY/,
    );
  });
});
