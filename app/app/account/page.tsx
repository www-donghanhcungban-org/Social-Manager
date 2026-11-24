import { requireUser } from "@/src/server/runtime";

import { DeleteAccountForm } from "./delete-account-form";

export const metadata = { title: "Tài khoản — X-Workspace" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Tài khoản và dữ liệu của bạn</h1>
      <p>
        {user.name} · <span className="break-all">{user.email}</span>
      </p>

      <section aria-labelledby="export-heading" className="flex flex-col gap-2">
        <h2 id="export-heading" className="text-lg font-semibold">
          Xuất dữ liệu của bạn
        </h2>
        <p>
          Tải về hồ sơ, danh sách workspace bạn tham gia, lịch sử đồng ý, phiên
          đăng nhập và hành động của bạn trong sổ audit (JSON). Dữ liệu trong
          workspace (tin nhắn, tài liệu) xuất theo từng dự án ở trang dự án.
        </p>
        {/* Tải tệp: biểu mẫu POST thường tới route handler (có ghi kiểm toán), không qua router phía client. */}
        <form method="post" action="/app/account/export" className="self-start">
          <button
            type="submit"
            className="rounded border border-border px-4 py-2"
          >
            Tải dữ liệu của tôi
          </button>
        </form>
      </section>

      <section aria-labelledby="delete-heading" className="flex flex-col gap-2">
        <h2 id="delete-heading" className="text-lg font-semibold">
          Xoá tài khoản
        </h2>
        <p>
          Xoá tài khoản gỡ bạn khỏi mọi workspace. Workspace chỉ có mình bạn bị
          xoá cùng toàn bộ tin nhắn, bằng chứng và tệp. Workspace còn người khác
          giữ nguyên dữ liệu; nếu bạn là chủ duy nhất, hãy chuyển quyền chủ
          trước. Sổ audit giữ lại các dòng ghi nhận an ninh (chỉ còn mã người
          dùng, không còn tên hay email) theo thời hạn đã công bố.
        </p>
        <DeleteAccountForm />
      </section>
    </main>
  );
}
