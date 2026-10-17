import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignInForm } from "../../components/sign-in-form";
import { auth } from "../../lib/auth";
import { sanitizeReturnTo } from "../../lib/auth-redirect";

export const metadata: Metadata = {
  title: "Sign in | Speed to Lead",
};

// The session check below must finish before any UI renders (to redirect
// authenticated visitors without flashing the form), so this route is
// intentionally allowed to block instead of prerendering a static shell.
export const instant = false;

/**
 * Shared sign-in page for platform operators and client users.
 *
 * Visitors with an already-valid session are sent through `/post-auth`, which
 * resolves the correct destination from verified server-side state.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    redirect("/post-auth");
  }

  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const returnTo = sanitizeReturnTo(rawNext ?? null);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Access your Speed to Lead workspace. Accounts are created by the
          platform team.
        </p>
        <SignInForm returnTo={returnTo} />
      </main>
    </div>
  );
}
