"use client";

/**
 * Biên lỗi của trang (BASE-ERR-003): chỉ hiện mã `digest` để đối chiếu với log; KHÔNG hiện thông điệp,
 * stack hay đường dẫn của lỗi gốc.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main role="alert" className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">Có lỗi xảy ra</h1>
      <p className="mt-2">
        Hãy thử lại. Nếu vẫn lỗi, báo mã sau cho quản trị viên:{" "}
        <code>{error.digest ?? "không có"}</code>
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded border px-3 py-1"
      >
        Thử lại
      </button>
    </main>
  );
}
