/**
 * Initial-password enforcement for Better Auth's `admin/create-user` route.
 *
 * Why this exists
 * ---------------
 * The shared initial-password policy (`password-policy.ts`, 8-128
 * characters) is validated by every application provisioning boundary before
 * `auth.api.createUser` is called. Better Auth's `admin/create-user` endpoint
 * itself, however, only enforces the *maximum* length
 * (`assertPasswordNotTooLong`, verified against `better-auth@1.7.10`); it
 * never applies `emailAndPassword.minPasswordLength`. Through the supported
 * `hooks.before` pipeline, this guard rejects out-of-policy initial passwords
 * for every caller of that route - both over HTTP and through `auth.api.*` -
 * with the same codes Better Auth uses elsewhere (`PASSWORD_TOO_SHORT` /
 * `PASSWORD_TOO_LONG`, mirroring `@better-auth/core` `BASE_ERROR_CODES`).
 *
 * Notes:
 * - Only the string `password` field is inspected. Omitted passwords (magic
 *   link / social-login-only accounts) and non-string values are left to
 *   Better Auth's own schema validation. An empty string is rejected as too
 *   short: the plugin would otherwise treat it as "no password" and create a
 *   credential-less account.
 * - `admin/set-user-password` already enforces both bounds in Better Auth and
 *   is intentionally not covered here.
 * - The password value itself is never logged, persisted, or included in any
 *   message.
 */
import { validateInitialPassword } from "./password-policy";

export interface InitialPasswordViolation {
  code: "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG";
  message: string;
}

/** The one route this guard applies to. */
const GUARDED_PATH = "/admin/create-user";

/**
 * Checks a raw `admin/create-user` payload against the shared initial-password
 * policy. Returns `null` when no policy decision is required (unguarded path,
 * no string password, or a valid password).
 */
export function checkInitialPasswordPayload(
  path: string,
  body: unknown,
): InitialPasswordViolation | null {
  if (path !== GUARDED_PATH) return null;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const password = (body as Record<string, unknown>).password;
  if (typeof password !== "string") return null;

  const check = validateInitialPassword(password);
  if (check.ok) return null;
  if (check.reason === "too_short") {
    return { code: "PASSWORD_TOO_SHORT", message: "Password too short" };
  }
  if (check.reason === "too_long") {
    return { code: "PASSWORD_TOO_LONG", message: "Password too long" };
  }
  return null; // `not_a_string` is unreachable: the field is a string above.
}
