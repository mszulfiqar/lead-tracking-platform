/**
 * Uniform organization-lookup guard for Better Auth's public organization
 * read and activation endpoints.
 *
 * Why this exists
 * ---------------
 * With `better-auth@1.7.10`, the organization plugin answers requests that
 * target a specific organization differently depending on whether that
 * organization exists:
 *
 * - the organization does not exist -> 400 `ORGANIZATION_NOT_FOUND`;
 * - the organization exists but the caller is not a member -> 403 with the
 *   endpoint-specific membership error.
 *
 * Any signed-in user can therefore use these endpoints as an existence
 * oracle for arbitrary organization slugs and IDs, even though the product
 * deliberately keeps organization management off the HTTP surface
 * (`disabledPaths` in `auth.ts`) and reads client organizations through
 * server-side membership checks only. This module closes exactly that
 * difference for the five endpoints that accept an explicit organization
 * target:
 *
 * - `GET  /organization/get-organization`
 * - `GET  /organization/get-full-organization`
 * - `POST /organization/set-active`
 * - `GET  /organization/list-members`
 * - `GET  /organization/get-active-member-role`
 *
 * Behavior, applied from the server-side `hooks.before` pipeline:
 * - requests without an explicit target (active-organization fallback) are
 *   left to Better Auth unchanged;
 * - unauthenticated requests are left to Better Auth (the plugin answers 401
 *   for every target);
 * - members of the targeted organization are left to Better Auth (full
 *   endpoint behavior preserved);
 * - every other caller receives the same endpoint-specific 403, byte-for-byte
 *   identical whether the organization exists or not.
 *
 * Lookup semantics mirror the plugin adapter exactly: exact-match slug and ID
 * lookups, and the caller's own membership row (`member.organizationId` +
 * `member.userId`). The guard removes the observable status/body difference
 * only; it does not claim to close timing side channels.
 */
import { APIError } from "better-auth/api";

export interface OrganizationLookupRejection {
  code: string;
  message: string;
}

/**
 * The guarded endpoints, each mapped to the uniform rejection that
 * non-members and unknown targets receive. Codes and messages match the
 * plugin's own error codes (`organization/error-codes.mjs`) so a rejected
 * non-member response is indistinguishable from the plugin's previous answer
 * for an existing organization.
 */
const GUARDED_PATHS = new Map<string, OrganizationLookupRejection>([
  [
    "/organization/get-organization",
    {
      code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
      message: "User is not a member of the organization",
    },
  ],
  [
    "/organization/get-full-organization",
    {
      code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
      message: "User is not a member of the organization",
    },
  ],
  [
    "/organization/set-active",
    {
      code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
      message: "User is not a member of the organization",
    },
  ],
  [
    "/organization/list-members",
    {
      code: "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION",
      message: "You are not a member of this organization",
    },
  ],
  [
    "/organization/get-active-member-role",
    {
      code: "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION",
      message: "You are not a member of this organization",
    },
  ],
]);

/** The uniform rejection for a guarded path, or `null` for any other path. */
export function organizationLookupRejection(
  path: string,
): OrganizationLookupRejection | null {
  return GUARDED_PATHS.get(path) ?? null;
}

export interface OrganizationLookupTarget {
  kind: "slug" | "id";
  value: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Extracts the explicitly targeted organization from a guarded request,
 * mirroring the plugin's own precedence:
 *
 * - `set-active`: an explicit `organizationId: null` unsets the active
 *   organization and ignores any slug; otherwise a non-empty `organizationId`
 *   wins over a non-empty `organizationSlug`; neither -> active-organization
 *   fallback;
 * - the GET endpoints: a non-empty `organizationSlug` wins over a non-empty
 *   `organizationId`; neither -> active-organization fallback.
 *
 * Returns `null` for unguarded paths and for requests without an explicit
 * target (absent, blank, or non-string values); those are left to Better Auth
 * and its own schema validation.
 */
export function resolveOrganizationLookupTarget(
  path: string,
  query: unknown,
  body: unknown,
): OrganizationLookupTarget | null {
  if (!GUARDED_PATHS.has(path)) return null;

  if (path === "/organization/set-active") {
    const record = asRecord(body);
    if (!record) return null;
    if (record.organizationId === null) return null; // Explicit unset.
    const organizationId = nonEmptyString(record.organizationId);
    if (organizationId) return { kind: "id", value: organizationId };
    const organizationSlug = nonEmptyString(record.organizationSlug);
    if (organizationSlug) return { kind: "slug", value: organizationSlug };
    return null;
  }

  const record = asRecord(query);
  if (!record) return null;
  const organizationSlug = nonEmptyString(record.organizationSlug);
  if (organizationSlug) return { kind: "slug", value: organizationSlug };
  const organizationId = nonEmptyString(record.organizationId);
  if (organizationId) return { kind: "id", value: organizationId };
  return null;
}

export interface OrganizationLookupGuardDeps {
  /** Resolves the signed-in user for the request, or `null` without a session. */
  getSessionUserId(headers: Headers): Promise<string | null>;
  /** Exact-match slug lookup, mirroring the plugin adapter. */
  findOrganizationIdBySlug(slug: string): Promise<string | null>;
  /** Exact membership check, mirroring the plugin adapter. */
  isOrganizationMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<boolean>;
}

export interface OrganizationLookupGuardContext {
  path: string;
  query?: unknown;
  body?: unknown;
  headers?: Headers;
}

/**
 * Creates the before-hook handler. It either returns (Better Auth handles the
 * request as before) or throws the uniform 403 for the targeted path.
 */
export function createOrganizationLookupGuard(
  deps: OrganizationLookupGuardDeps,
) {
  return async function organizationLookupGuard(
    context: OrganizationLookupGuardContext,
  ): Promise<void> {
    const rejection = organizationLookupRejection(context.path);
    if (!rejection) return;
    const target = resolveOrganizationLookupTarget(
      context.path,
      context.query,
      context.body,
    );
    if (!target) return;
    if (!context.headers) return; // No headers: the plugin answers 401.

    const userId = await deps.getSessionUserId(context.headers);
    if (!userId) return; // Unauthenticated: every target gets the same 401.

    const organizationId =
      target.kind === "slug"
        ? await deps.findOrganizationIdBySlug(target.value)
        : target.value;
    if (organizationId) {
      const isMember = await deps.isOrganizationMember({
        organizationId,
        userId,
      });
      if (isMember) return; // Member: full endpoint behavior is preserved.
    }

    throw APIError.from("FORBIDDEN", rejection);
  };
}
