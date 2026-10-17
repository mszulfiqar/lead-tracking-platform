import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignOutButton } from "../../components/sign-out-button";
import { resolveWorkspaceAccess } from "../../lib/organization-access";

export const metadata: Metadata = {
  title: "Workspace | Speed to Lead",
};

// The session and membership checks below must finish before any UI renders,
// so this route is intentionally allowed to block instead of prerendering a
// static shell.
export const instant = false;

/**
 * Minimal client workspace.
 *
 * The workspace shown here is resolved on the server from the verified
 * session user's own membership rows. The route accepts no organization ID
 * or slug, and none is read from the URL, request body, or client state, so a
 * member can never select another tenant.
 */
export default async function WorkspacePage() {
  const access = await resolveWorkspaceAccess(await headers());

  if (access.status === "unauthenticated") {
    redirect("/sign-in?next=/workspace");
  }
  if (access.status === "no-membership") {
    redirect("/no-access");
  }

  const { user, organization } = access;

  return (
    <div className="flex flex-1 items-start justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
          Client workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {organization.name}
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {user.email}
          </span>{" "}
          as the workspace {organization.role}. This workspace was resolved on
          the server from your account&apos;s verified organization membership.
        </p>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Lead management features will appear here in later releases.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </main>
    </div>
  );
}
