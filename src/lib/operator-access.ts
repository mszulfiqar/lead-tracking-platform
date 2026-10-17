/**
 * Server-side platform-operator authorization.
 *
 * Operator privileges are granted only when BOTH conditions hold:
 * 1. The request carries a valid Better Auth session (verified on the server),
 *    and
 * 2. The session's verified user ID appears in the server-side
 *    `PLATFORM_OPERATOR_USER_IDS` allowlist.
 *
 * Organization membership, roles, emails, URLs, request bodies, and
 * client-side state never grant operator privileges. If the allowlist is
 * missing or invalid, operator access is denied for everyone.
 *
 * This module intentionally avoids `next/headers` so it can be exercised by
 * scripts and tests; callers pass the request headers explicitly.
 */
import { auth } from "./auth";
import { parseOperatorAllowlist } from "./operator-allowlist";

export interface OperatorCandidate {
  id: string;
  email: string;
  name: string;
}

export type OperatorAccess =
  | { status: "unauthenticated" }
  | {
      status: "denied";
      user: OperatorCandidate;
      /** Why operator access was denied for an authenticated user. */
      allowlistProblem: "missing" | "invalid" | null;
    }
  | { status: "operator"; user: OperatorCandidate };

export async function resolveOperatorAccess(
  requestHeaders: Headers,
  allowlistEnv: string | null | undefined = process.env.PLATFORM_OPERATOR_USER_IDS,
): Promise<OperatorAccess> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return { status: "unauthenticated" };
  }

  const user: OperatorCandidate = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };

  const parsed = parseOperatorAllowlist(allowlistEnv);
  if (parsed.ok && parsed.ids.has(user.id)) {
    return { status: "operator", user };
  }

  return {
    status: "denied",
    user,
    allowlistProblem: parsed.ok ? null : parsed.reason,
  };
}
