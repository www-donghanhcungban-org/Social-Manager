import Link from "next/link";

export const metadata = { title: "Không tìm thấy — X-Workspace" };

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-xl font-semibold">Không tìm thấy trang</h1>
      <p className="mt-2 text-muted-foreground">
        Trang không tồn tại hoặc bạn không có quyền xem.
      </p>
      <Link href="/app" className="mt-4 inline-block text-primary underline">
        Về trang chính
      </Link>
    </main>
  );
}
