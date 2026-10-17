import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ProvisionClientForm } from "../../components/provision-client-form";
import { SignOutButton } from "../../components/sign-out-button";
import { resolveOperatorAccess } from "../../lib/operator-access";

export const metadata: Metadata = {
  title: "Operator console | Speed to Lead",
};

// Access is authorized on the server before any UI renders, so this route is
// intentionally allowed to block instead of prerendering a static shell.
export const instant = false;

/**
 * Protected platform-operator route.
 *
 * Access is authorized on the server for every request: a valid session is
 * required, and the verified user ID must appear in the
 * `PLATFORM_OPERATOR_USER_IDS` allowlist. Organization membership is not
 * required, and no client-supplied value can grant access.
 */
export default async function OperatorPage() {
  const access = await resolveOperatorAccess(await headers());

  if (access.status === "unauthenticated") {
    redirect("/sign-in?next=/operator");
  }
  if (access.status !== "operator") {
    redirect("/no-access");
  }

  return (
    <div className="flex flex-1 items-start justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
          Platform operator
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Operator console
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Signed in as{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {access.user.email}
          </span>
          . Operator access was verified on the server against the configured
          operator allowlist and does not depend on organization membership.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>

        <section className="mt-8 border-t border-zinc-200 pt-8 dark:border-zinc-800">
          <h2 className="text-lg font-semibold tracking-tight">
            Create a client workspace
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Provisions the client organization and its owner account. The
            client signs in at the shared sign-in page with the email address
            and the initial password you set here; the password is never shown
            or stored again, so pass it on directly.
          </p>
          <div className="mt-6">
            <ProvisionClientForm />
          </div>
        </section>
      </main>
    </div>
  );
}
