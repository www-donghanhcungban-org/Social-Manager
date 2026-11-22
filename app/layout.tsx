import type { Metadata } from "next";
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
  title: "Social Manager",
  description:
    "Quản lý mạng xã hội ở một nơi: hộp thư hợp nhất, đăng bài, thống kê.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
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
