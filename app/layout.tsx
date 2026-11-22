import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "X-Workspace",
  description:
    "Quản lý mạng xã hội ở một nơi: hộp thư hợp nhất, đăng bài, thống kê.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Đọc header buộc mọi route render động mỗi request, nhờ đó Next gắn nonce của CSP (proxy.ts) vào script.
  // Vỏ tĩnh dựng sẵn không có nonce nên bị `strict-dynamic` chặn (đã gặp khi bật Cache Components, D-006).
  await headers();
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Trang đọc phiên đăng nhập (dữ liệu runtime) nên cần ranh giới Suspense để Cache Components build được. */}
        <Suspense
          fallback={
            <p role="status" className="p-6 text-muted-foreground">
              Đang tải…
            </p>
          }
        >
          {children}
        </Suspense>
      </body>
    </html>
  );
}
