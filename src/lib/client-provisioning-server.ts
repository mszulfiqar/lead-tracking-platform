/**
 * Server-side wiring for operator-managed client provisioning.
 *
 * This module injects the real dependencies (the Better Auth server APIs and
 * the application database) into the dependency-injected flow in
 * `client-provisioning.ts`. The operator authorization gate
 * (`resolveOperatorAccess`) is part of the wiring, so every entry point that
 * uses these dependencies evaluates authorization against the caller's
 * request headers before anything is created.
 *
 * The database access targets the application database this deployment is
 * configured for. It is never called during unit tests (which inject their
 * own dependencies) and, in tests, the Vitest setup redirects `DATABASE_URL`
 * to the dedicated test database.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization, user } from "../db/auth-schema";
import { auth } from "./auth";
import type {
  ClientProvisioningResult,
  ProvisioningDeps,
  ProvisioningInput,
} from "./client-provisioning";
import { provisionClientWorkspace } from "./client-provisioning";
import { resolveOperatorAccess } from "./operator-access";

export function createProvisioningDeps(): ProvisioningDeps {
  return {
    resolveOperatorAccess,
    async findUserIdByEmail(email) {
      const rows = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
      return rows[0]?.id ?? null;
    },
    async findOrganizationBySlug(slug) {
      const rows = await db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        })
        .from(organization)
        .where(eq(organization.slug, slug))
        .limit(1);
      return rows[0] ?? null;
    },
    async createClientUser({ email, name, password }) {
      // Better Auth's supported server-side user-creation API. This hashes the
      // password and assigns the default `user` role; no role is passed.
      const created = await auth.api.createUser({
        body: { email, name, password },
      });
      return { id: created.user.id };
    },
    async createOrganizationForOwner({ name, slug, ownerUserId }) {
      // Called without session headers: the specified user becomes the
      // organization creator and receives the approved `owner` membership
      // role (verified in the organization-plugin integration tests).
      const created = await auth.api.createOrganization({
        body: { name, slug, userId: ownerUserId },
      });
      return { id: created.id };
    },
    async findMembership({ organizationId, userId }) {
      const rows = await db
        .select({ role: member.role })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.userId, userId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async deleteUser(userId) {
      // Deletes exactly the single user row identified by this ID; related
      // accounts, sessions, and memberships cascade.
      await db.delete(user).where(eq(user.id, userId));
    },
    log(message) {
      console.info(`[client-provisioning] ${message}`);
    },
  };
}

/**
 * Real entry point for server code (the operator console is wired to this in
 * a later approved batch). The request headers are required so the operator
 * authorization gate is always evaluated.
 */
export function provisionClientWorkspaceForRequest(
  requestHeaders: Headers,
  input: ProvisioningInput,
): Promise<ClientProvisioningResult> {
  return provisionClientWorkspace(requestHeaders, input, createProvisioningDeps());
}
