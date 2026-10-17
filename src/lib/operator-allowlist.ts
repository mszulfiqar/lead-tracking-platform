/**
 * Pure parsing and membership checks for the server-side platform-operator
 * allowlist (`PLATFORM_OPERATOR_USER_IDS`).
 *
 * Rules:
 * - The allowlist is a comma-separated list of Better Auth user IDs.
 * - Missing, empty, or invalid configuration denies operator access for
 *   everyone (fail closed).
 * - Membership is an exact, case-sensitive comparison against the verified
 *   user ID. Emails, roles, URL parameters, and any other client-supplied
 *   value are never considered.
 *
 * This module has no server or database dependencies so it can be unit tested
 * in isolation.
 */
export const PLATFORM_OPERATOR_USER_IDS_ENV = "PLATFORM_OPERATOR_USER_IDS";

const MAX_USER_ID_LENGTH = 256;

export type OperatorAllowlistParseResult =
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "invalid"; detail: string }
  | { ok: true; ids: ReadonlySet<string> };

export function parseOperatorAllowlist(
  raw: string | null | undefined,
): OperatorAllowlistParseResult {
  const value = raw?.trim() ?? "";
  if (value === "") {
    return { ok: false, reason: "missing" };
  }

  const ids = new Set<string>();
  for (const entry of value.split(",")) {
    const id = entry.trim();
    if (id === "") continue;
    if (id.length > MAX_USER_ID_LENGTH) {
      return {
        ok: false,
        reason: "invalid",
        detail: "An operator user ID exceeds the supported length.",
      };
    }
    if (/\s/.test(id) || /[\u0000-\u001f\u007f]/.test(id)) {
      return {
        ok: false,
        reason: "invalid",
        detail: "Every allowlist entry must be a single user-ID token without whitespace.",
      };
    }
    ids.add(id);
  }

  if (ids.size === 0) {
    return { ok: false, reason: "missing" };
  }
  return { ok: true, ids };
}

export function isOperatorUserId(
  userId: string | null | undefined,
  rawAllowlist: string | null | undefined,
): boolean {
  if (!userId) return false;
  const parsed = parseOperatorAllowlist(rawAllowlist);
  return parsed.ok && parsed.ids.has(userId);
}
