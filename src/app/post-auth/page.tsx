import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { postAuthDestination } from "../../lib/auth-redirect";
import { resolveClientOrganization } from "../../lib/organization-access";
import { resolveOperatorAccess } from "../../lib/operator-access";

// This route is a pure server-side redirect driven by verified session state,
// so it is intentionally allowed to block instead of prerendering a shell.
export const instant = false;

/**
 * Resolves the correct destination for an authenticated user from verified
 * server-side state only: the session, the operator allowlist, and — for
 * non-operators — the user's own verified workspace membership. Client input
 * (query parameters, headers, or client state) never influences the decision.
 * Operator access is checked first; membership never grants operator
 * privileges.
 */
export default async function PostAuthPage() {
  const requestHeaders = await headers();
  const access = await resolveOperatorAccess(requestHeaders);

  const hasVerifiedMembership =
    access.status === "denied"
      ? (await resolveClientOrganization(access.user.id)) !== null
      : false;

  redirect(postAuthDestination(access, hasVerifiedMembership));
}
