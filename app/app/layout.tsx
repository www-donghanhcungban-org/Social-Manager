import Link from "next/link";
import type { ReactNode } from "react";

import { requireUser } from "@/src/server/runtime";

import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border p-4">
        <Link href="/app" className="font-semibold">
          Social Manager
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}
