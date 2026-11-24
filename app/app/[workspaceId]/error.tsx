"use client";

import Link from "next/link";

/**
 * Biên lỗi cho các trang trong workspace (UX-STATE-005): chỉ hiện mã `digest` để đối chiếu log; không hiện
 * thông điệp, stack hay chi tiết nội bộ của lỗi gốc. Có nút "Thử lại" và đường đi khác về danh sách workspace.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="p-4">
      <h2 className="text-lg font-semibold">Không tải được trang này</h2>
      <p className="mt-2">
        Hãy thử lại. Nếu vẫn lỗi, báo mã sau cho quản trị viên:{" "}
        <code>{error.digest ?? "không có"}</code>
      </p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded border border-border px-3 py-1"
        >
          Thử lại
        </button>
        <Link href="/app" className="rounded border border-border px-3 py-1">
          Về danh sách workspace
        </Link>
      </div>
    </div>
  );
}
