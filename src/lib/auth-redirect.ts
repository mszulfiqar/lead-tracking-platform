/**
 * Safe post-authentication routing helpers.
 *
 * Redirect targets are resolved on the server from the verified session and
 * the operator allowlist; they are never derived from client-supplied
 * privilege claims. A client-supplied `next` value is accepted only as a
 * same-origin application path, so it can never produce an external redirect
 * or a protocol-relative URL.
 */
import type { OperatorAccess } from "./operator-access";

const MAX_RETURN_TO_LENGTH = 512;

// Same-origin absolute paths only: must start with a single "/", must not
// contain backslashes or control characters (which browsers may normalize),
// and must stick to characters that are safe in a URL path/query.
const SAFE_RETURN_TO_PATTERN = /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#[\]]*$/;

/**
 * Returns the validated same-origin path, or `null` when the value is missing,
 * too long, external, protocol-relative, or otherwise unsafe.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_RETURN_TO_LENGTH) return null;
  if (value.includes("\\")) return null;
  if (!SAFE_RETURN_TO_PATTERN.test(value)) return null;
  return value;
}

/**
 * Destination for an authenticated user after sign-in.
 *
 * The decision is based only on verified server-side state: the operator
 * allowlist (through `access`) and, for non-operators, whether a workspace
 * membership was verified for the session user. `hasVerifiedMembership` must
 * be derived from a server-side membership lookup for the verified session
 * user — never from client input. Organization membership never grants
 * operator privileges: an allowlisted operator always lands on the operator
 * console.
 */
export function postAuthDestination(
  access: OperatorAccess,
  hasVerifiedMembership: boolean,
): string {
  switch (access.status) {
    case "operator":
      return "/operator";
    case "denied":
      return hasVerifiedMembership ? "/workspace" : "/no-access";
    case "unauthenticated":
      return "/sign-in";
  }
}
