import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignOutButton } from "../../components/sign-out-button";
import { resolveOperatorAccess } from "../../lib/operator-access";

export const metadata: Metadata = {
  title: "No workspace access | Speed to Lead",
};

// The session check below must finish before any UI renders, so this route is
// intentionally allowed to block instead of prerendering a static shell.
export const instant = false;

/**
 * Destination for authenticated users who are neither platform operators nor
 * authorized members of a workspace. It grants no access and exposes no
 * protected data.
 */
export default async function NoAccessPage() {
  const access = await resolveOperatorAccess(await headers());

  if (access.status === "unauthenticated") {
    redirect("/sign-in?next=/no-access");
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight">
          No workspace access yet
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          You are signed in as{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {access.user.email}
          </span>
          , but this account does not have access to a workspace. Client
          accounts are created by the platform team; contact your platform
          operator if you believe you should have access.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </main>
    </div>
  );
}
