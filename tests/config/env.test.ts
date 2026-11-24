import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  ConfigError,
  ENV_KEYS,
  SECRET_KEYS,
  loadEnv,
  loadEnvOrExit,
  redactEnv,
} from "@/src/config/env";

const valid = () => ({
  DATABASE_URL: "postgres://app:mat-khau-that@db.internal:5432/social",
  BETTER_AUTH_SECRET: "s".repeat(48),
  BETTER_AUTH_URL: "https://social.example.com",
  APP_SECRET_KEY: randomBytes(32).toString("base64"),
});

const without = (name: string) => ({ ...valid(), [name]: undefined });

describe("loadEnv", () => {
  it("đủ biến hợp lệ thì trả cấu hình có kiểu, kèm mặc định an toàn", () => {
    const env = loadEnv(valid());
    expect(env.BETTER_AUTH_URL).toBe("https://social.example.com");
    expect(env.NODE_ENV).toBe("development");
    expect(env.SOCIALAPI_BASE_URL).toBe("https://api.social-api.ai/v1");
  });

  it.each([
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "APP_SECRET_KEY",
  ])("thiếu %s thì ném ConfigError nêu đúng tên biến đó", (name) => {
    const err = (() => {
      try {
        loadEnv(without(name));
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).keys).toEqual([name]);
  });

  it("AI tắt mặc định; đặt AI_BASE_URL thì bắt buộc AI_MODEL; khoá API là bí mật và bị che", () => {
    const off = loadEnv(valid());
    expect(off.AI_BASE_URL).toBeUndefined();
    expect(off.AI_MODEL).toBeUndefined();
    expect(() =>
      loadEnv({ ...valid(), AI_BASE_URL: "http://localhost:11434/v1" }),
    ).toThrow(/AI_MODEL/);
    const on = loadEnv({
      ...valid(),
      AI_BASE_URL: "http://localhost:11434/v1",
      AI_MODEL: "qwen3",
      AI_API_KEY: "sk-secret-ai-key",
    });
    expect(on.AI_MODEL).toBe("qwen3");
    expect(SECRET_KEYS).toContain("AI_API_KEY");
    expect(JSON.stringify(redactEnv(on))).not.toContain("sk-secret-ai-key");
    // giá trị rỗng coi như tắt; URL sai/không phải http(s) bị từ chối
    expect(
      loadEnv({ ...valid(), AI_BASE_URL: "  " }).AI_BASE_URL,
    ).toBeUndefined();
    for (const bad of ["ftp://x/v1", "không phải url"])
      expect(() =>
        loadEnv({ ...valid(), AI_BASE_URL: bad, AI_MODEL: "m" }),
      ).toThrow(ConfigError);
  });

  it("OUTBOUND_LIVE mặc định tắt; chỉ nhận true/false; rỗng coi như tắt", () => {
    expect(loadEnv(valid()).OUTBOUND_LIVE).toBe("false");
    expect(loadEnv({ ...valid(), OUTBOUND_LIVE: "  " }).OUTBOUND_LIVE).toBe(
      "false",
    );
    expect(loadEnv({ ...valid(), OUTBOUND_LIVE: "true" }).OUTBOUND_LIVE).toBe(
      "true",
    );
    for (const bad of ["1", "yes", "TRUE"])
      expect(() => loadEnv({ ...valid(), OUTBOUND_LIVE: bad })).toThrow(
        ConfigError,
      );
  });

  it("giá trị rỗng hoặc chỉ khoảng trắng coi như thiếu [F-005/AC-04]", () => {
    for (const v of ["", "   "]) {
      expect(() => loadEnv({ ...valid(), BETTER_AUTH_URL: v })).toThrow(
        ConfigError,
      );
    }
  });

  it("liệt kê MỌI biến sai cùng lúc, không dừng ở biến đầu tiên [F-005/AC-04]", () => {
    try {
      loadEnv({});
      expect.unreachable();
    } catch (e) {
      expect((e as ConfigError).keys).toEqual(
        expect.arrayContaining([
          "DATABASE_URL",
          "BETTER_AUTH_SECRET",
          "BETTER_AUTH_URL",
          "APP_SECRET_KEY",
        ]),
      );
    }
  });

  it("từ chối URL sai định dạng, DATABASE_URL không phải postgres, secret quá ngắn, khoá chủ sai độ dài [F-005/AC-04]", () => {
    for (const bad of [
      { BETTER_AUTH_URL: "không phải url" },
      { DATABASE_URL: "mysql://u:p@h/db" },
      { BETTER_AUTH_SECRET: "ngan" },
      { APP_SECRET_KEY: randomBytes(16).toString("base64") },
      { APP_SECRET_KEY: "a".repeat(43) }, // giải được 32 byte nhưng không phải base64 chuẩn
      { APP_SECRET_KEY: "this-is-my-very-own-password-for-the-app-42" },
      { NODE_ENV: "staging-la" },
    ]) {
      expect(() => loadEnv({ ...valid(), ...bad })).toThrow(ConfigError);
    }
  });

  it("CLIENT_IP_HEADER và AUTH_RATE_LIMIT_PER_MIN: mặc định, hợp lệ và từ chối giá trị sai", () => {
    const base = valid();
    const d = loadEnv(base);
    expect(d.CLIENT_IP_HEADER).toBeUndefined();
    expect(d.AUTH_RATE_LIMIT_PER_MIN).toBe(10);
    const ok = loadEnv({
      ...base,
      CLIENT_IP_HEADER: " x-real-ip ",
      AUTH_RATE_LIMIT_PER_MIN: "25",
    });
    expect(ok.CLIENT_IP_HEADER).toBe("x-real-ip");
    expect(ok.AUTH_RATE_LIMIT_PER_MIN).toBe(25);
    for (const bad of [
      { CLIENT_IP_HEADER: "x real ip" },
      { CLIENT_IP_HEADER: "a:b" },
      { AUTH_RATE_LIMIT_PER_MIN: "0" },
      { AUTH_RATE_LIMIT_PER_MIN: "-3" },
      { AUTH_RATE_LIMIT_PER_MIN: "2.5" },
      { AUTH_RATE_LIMIT_PER_MIN: "abc" },
      { AUTH_RATE_LIMIT_PER_MIN: "10001" },
    ]) {
      expect(() => loadEnv({ ...base, ...bad })).toThrow(ConfigError);
    }
  });

  it("thông báo lỗi không chứa giá trị bí mật dù giá trị đó là nguyên nhân gây lỗi [F-005/AC-04]", () => {
    const secretLooking = "mat-khau-sieu-bi-mat-khong-duoc-lo";
    try {
      loadEnv({
        ...valid(),
        APP_SECRET_KEY: secretLooking,
        BETTER_AUTH_SECRET: secretLooking.slice(0, 5),
      });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(secretLooking);
      expect((e as Error).message).not.toContain(secretLooking.slice(0, 5));
      expect((e as Error).message).toContain("APP_SECRET_KEY");
    }
  });
});

describe("loadEnvOrExit", () => {
  it("cấu hình sai: in tên biến ra stderr, thoát mã 1, không in giá trị [F-005/AC-04]", () => {
    const stderr = vi.fn();
    const exit = vi.fn((code: number): never => {
      throw new Error(`exit ${code}`);
    });
    expect(() =>
      loadEnvOrExit(
        { ...valid(), BETTER_AUTH_SECRET: "ngan-bi-mat" },
        { exit, stderr },
      ),
    ).toThrow("exit 1");
    expect(exit).toHaveBeenCalledWith(1);
    const out = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("BETTER_AUTH_SECRET");
    expect(out).not.toContain("ngan-bi-mat");
  });

  it("cấu hình đúng: không thoát, trả cấu hình", () => {
    const exit = vi.fn();
    const env = loadEnvOrExit(valid(), {
      exit: exit as never,
      stderr: vi.fn(),
    });
    expect(env.NODE_ENV).toBe("development");
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("redactEnv", () => {
  it("che mọi biến bí mật khi in/dump, giữ nguyên biến công khai", () => {
    const dump = JSON.stringify(redactEnv(loadEnv(valid())));
    const v = valid();
    for (const secret of [
      v.DATABASE_URL,
      v.BETTER_AUTH_SECRET,
      v.APP_SECRET_KEY,
    ]) {
      expect(dump).not.toContain(secret);
    }
    expect(dump).toContain("https://social.example.com");
    expect(dump).toContain("***");
  });
});

describe("quy ước biến môi trường", () => {
  it("không biến bí mật nào mang tiền tố công khai NEXT_PUBLIC_", () => {
    for (const k of SECRET_KEYS)
      expect(k.startsWith("NEXT_PUBLIC_")).toBe(false);
    for (const k of ENV_KEYS) expect(k.startsWith("NEXT_PUBLIC_")).toBe(false);
  });

  it("mọi biến bí mật đều thuộc schema (không che nhầm tên không tồn tại)", () => {
    for (const k of SECRET_KEYS) expect(ENV_KEYS).toContain(k);
  });
});
