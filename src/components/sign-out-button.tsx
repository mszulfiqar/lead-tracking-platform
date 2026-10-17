"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "../lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await authClient.signOut();
    } finally {
      router.replace("/sign-in");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className="flex h-9 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
