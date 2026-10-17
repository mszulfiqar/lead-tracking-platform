/**
 * Better Auth server configuration.
 *
 * - Authentication establishes identity only. Platform operator privileges are
 *   determined separately from the `PLATFORM_OPERATOR_USER_IDS` allowlist
 *   (see `operator-allowlist.ts` / `operator-access.ts`), never from Better
 *   Auth roles.
 * - Public self-registration is disabled (`emailAndPassword.disableSignUp`).
 *   Accounts are created only through server-side provisioning
 *   (`auth.api.createUser`, used by the operator bootstrap script and by
 *   operator-managed onboarding in later approved batches).
 * - Passwords are hashed and verified exclusively by Better Auth's supported
 *   password mechanism. Plaintext passwords are never stored or logged.
 * - Two `hooks.before` guards close platform-level gaps in Better Auth's
 *   plugin routes: `organization-lookup-guard.ts` makes organization
 *   lookups indistinguishable for non-members (no existence disclosure), and
 *   `initial-password-guard.ts` enforces the shared 8-128 initial-password
 *   policy on `admin/create-user` (Better Auth only checks the maximum there).
 *
 * `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET` are read from the environment by
 * Better Auth itself; they are passed explicitly here for clarity. Neither
 * value is ever logged or exposed to the client.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import * as schema from "../db/schema";
import { checkInitialPasswordPayload } from "./initial-password-guard";
import { createOrganizationLookupGuard } from "./organization-lookup-guard";
import {
  INITIAL_PASSWORD_MAX_LENGTH,
  INITIAL_PASSWORD_MIN_LENGTH,
} from "./password-policy";

// The organization-lookup guard runs against the same database the adapter
// uses. Its session lookup closes over `auth`, which is initialized at the end
// of this module; the closures only run per request, after initialization.
const organizationLookupGuard = createOrganizationLookupGuard({
  async getSessionUserId(headers) {
    const session = await auth.api.getSession({ headers });
    return session?.user.id ?? null;
  },
  async findOrganizationIdBySlug(slug) {
    const rows = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, slug))
      .limit(1);
    return rows[0]?.id ?? null;
  },
  async isOrganizationMember({ organizationId, userId }) {
    const rows = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, userId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },
});

export const auth = betterAuth({
  appName: "Speed to Lead",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    // Do not allow visitors to create accounts through the public API.
    // Server-side provisioning through `auth.api.createUser` still works.
    disableSignUp: true,
    minPasswordLength: INITIAL_PASSWORD_MIN_LENGTH,
    maxPasswordLength: INITIAL_PASSWORD_MAX_LENGTH,
  },
  // Public self-service organization management is not part of the approved
  // product: organizations, memberships, invitations, and roles are created
  // and managed only by trusted server-side operator code, which calls
  // Better Auth's server APIs directly. These HTTP routes would otherwise let
  // any signed-in client - including a provisioned organization owner, whose
  // built-in `owner` role carries organization/member/invitation management
  // permissions - change or delete organization settings, invite or remove
  // members, change roles, or probe whether another tenant's workspace slug
  // exists. Disabling the routes at the Better Auth router makes them return
  // 404 for every HTTP caller (regardless of role), while server-side
  // `auth.api.*` calls used by operator provisioning are unaffected.
  disabledPaths: [
    "/organization/update",
    "/organization/delete",
    "/organization/invite-member",
    "/organization/cancel-invitation",
    "/organization/remove-member",
    "/organization/update-member-role",
    "/organization/check-slug",
  ],
  // Server-side before hooks; they run for HTTP requests and `auth.api.*`
  // calls alike, before the endpoint's own validation and middlewares:
  // 1. organization lookups stop disclosing whether an organization exists
  //    (`organization-lookup-guard.ts`), returning a uniform 403 to
  //    non-members for both existing and unknown targets;
  // 2. `admin/create-user` enforces the shared 8-128 initial-password policy
  //    (`initial-password-guard.ts`), which Better Auth itself only partially
  //    applies on that route.
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      await organizationLookupGuard({
        path: ctx.path,
        query: ctx.query,
        body: ctx.body,
        headers: ctx.headers instanceof Headers ? ctx.headers : undefined,
      });
      const violation = checkInitialPasswordPayload(ctx.path, ctx.body);
      if (violation) {
        throw APIError.from("BAD_REQUEST", violation);
      }
    }),
  },
  plugins: [
    // Provides the documented server-side user-creation API used by the
    // one-time operator bootstrap script. The default role is "user"; this
    // plugin must never be used as a substitute for the platform-operator
    // allowlist, and no account is ever given the built-in "admin" role.
    admin({ defaultRole: "user" }),
    // Provides the organization tables and the documented server-side
    // organization-creation API used by operator-managed onboarding in later
    // approved batches. `creatorRole: "owner"` is the approved client role for
    // provisioned client owners. `allowUserToCreateOrganization: false`
    // disables self-service organization creation for every signed-in user:
    // the plugin's public `/organization/create` endpoint rejects non-system
    // calls, and only the server-side operator-authorized provisioning flow
    // (which invokes the system path) may create organizations.
    // `disableOrganizationDeletion: true` guarantees that no caller can delete
    // an organization through the plugin API at all; no approved flow deletes
    // organizations. Organization membership and roles never grant
    // platform-operator privileges; those come exclusively from
    // `PLATFORM_OPERATOR_USER_IDS`.
    organization({
      creatorRole: "owner",
      allowUserToCreateOrganization: false,
      disableOrganizationDeletion: true,
    }),
    // Must remain the last plugin so cookie mutations from Better Auth server
    // calls are propagated to Next.js server actions and route handlers.
    nextCookies(),
  ],
});
