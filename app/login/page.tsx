import { redirect } from "next/navigation";

import { currentUser } from "@/src/server/runtime";

import { AuthForm } from "./auth-form";

export const metadata = { title: "Đăng nhập — X-Workspace" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/app");
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">X-Workspace</h1>
        <p className="mt-1 text-muted-foreground">
          Quản lý mạng xã hội của bạn ở một nơi.
        </p>
      </header>
      <AuthForm />
    </main>
  );
}
