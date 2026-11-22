"use client";

import { useRouter } from "next/navigation";

import { authClient } from "@/src/auth/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-sm text-primary underline"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      Đăng xuất
    </button>
  );
}
