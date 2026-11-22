"use client";

/** Biên lỗi cuối cùng (lỗi ở chính layout). Như `error.tsx`: chỉ hiện `digest`. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="vi">
      <body>
        <main role="alert" style={{ maxWidth: 560, margin: "2rem auto" }}>
          <h1>Có lỗi xảy ra</h1>
          <p>
            Báo mã sau cho quản trị viên:{" "}
            <code>{error.digest ?? "không có"}</code>
          </p>
          <button type="button" onClick={reset}>
            Thử lại
          </button>
        </main>
      </body>
    </html>
  );
}
