"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/src/auth/client";

type Mode = "signin" | "signup";

const MIN_PASSWORD = 12;

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    setBusy(true);
    try {
      if (mode === "signup") {
        // Phản hồi đăng ký giống nhau dù email đã có hay chưa (không lộ email nào đã đăng ký);
        // đăng nhập ngay sau đó mới quyết định thành công hay không.
        const up = await authClient.signUp.email({ email, password, name });
        if (up.error && up.error.code === "PASSWORD_TOO_SHORT") {
          setError(`Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.`);
          return;
        }
      }
      const res = await authClient.signIn.email({ email, password });
      if (res.error) {
        setError(
          mode === "signup"
            ? "Không đăng ký hoặc đăng nhập được. Kiểm tra email và mật khẩu, hoặc đăng nhập nếu bạn đã có tài khoản."
            : "Email hoặc mật khẩu không đúng.",
        );
        return;
      }
      router.replace("/app");
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "mt-1 w-full rounded border border-border bg-background px-3 py-2";
  // Lỗi của biểu mẫu gắn vào mọi ô nhập (FE-FORM-002): aria-invalid + aria-describedby trỏ tới phần tử chứa lỗi.
  const invalid = error
    ? ({ "aria-invalid": true, "aria-describedby": "auth-error" } as const)
    : {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h2 className="text-lg font-medium">
        {mode === "signin" ? "Đăng nhập" : "Tạo tài khoản"}
      </h2>
      {mode === "signup" && (
        <label className="block">
          Tên hiển thị
          <input
            name="name"
            type="text"
            required
            autoComplete="name"
            className={input}
            {...invalid}
          />
        </label>
      )}
      <label className="block">
        Email
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className={input}
          {...invalid}
        />
      </label>
      <label className="block">
        Mật khẩu
        <input
          name="password"
          type="password"
          required
          minLength={MIN_PASSWORD}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          className={input}
          {...{
            "aria-describedby": error
              ? "auth-error password-hint"
              : "password-hint",
            ...(error ? { "aria-invalid": true } : {}),
          }}
        />
        {mode === "signup" && (
          <span
            id="password-hint"
            className="mt-1 block text-sm text-muted-foreground"
          >
            Tối thiểu {MIN_PASSWORD} ký tự.
          </span>
        )}
      </label>
      <p
        id="auth-error"
        role="alert"
        aria-live="polite"
        className="min-h-6 text-danger"
      >
        {error}
      </p>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60"
      >
        {busy
          ? "Đang xử lý…"
          : mode === "signin"
            ? "Đăng nhập"
            : "Tạo tài khoản"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
        }}
        className="text-sm text-primary underline"
      >
        {mode === "signin"
          ? "Chưa có tài khoản? Tạo mới"
          : "Đã có tài khoản? Đăng nhập"}
      </button>
    </form>
  );
}
