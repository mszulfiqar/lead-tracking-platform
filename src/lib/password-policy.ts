/**
 * Initial-password policy for accounts created through server-side
 * provisioning (operator bootstrap and, in later approved batches,
 * operator-managed client account creation).
 *
 * Better Auth enforces the same bounds through its `emailAndPassword`
 * configuration; this module is the single source of truth for the numeric
 * limits so scripts, tests, and the auth configuration cannot drift apart.
 *
 * The policy applies to plaintext passwords only while they are being
 * validated in memory. Passwords must never be logged, persisted, or included
 * in URLs or error messages.
 */
export const INITIAL_PASSWORD_MIN_LENGTH = 8;
export const INITIAL_PASSWORD_MAX_LENGTH = 128;

export type InitialPasswordValidation =
  | { ok: true }
  | { ok: false; reason: "not_a_string" | "too_short" | "too_long" };

export function validateInitialPassword(password: unknown): InitialPasswordValidation {
  if (typeof password !== "string") {
    return { ok: false, reason: "not_a_string" };
  }
  if (password.length < INITIAL_PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (password.length > INITIAL_PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true };
}
