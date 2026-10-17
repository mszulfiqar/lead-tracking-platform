/**
 * Server-side resolution of a client user's organization (workspace).
 *
 * The organization a signed-in client may access is derived exclusively from
 * the verified session user's own membership rows. The caller never supplies
 * an organization ID or slug, and client-supplied values (URL parameters,
 * request bodies, headers, or client state) are never consulted as evidence
 * of authorization. A user without a verified membership resolves to `null`,
 * which routes to the existing no-access experience.
 *
 * Like `operator-access.ts`, this module avoids `next/headers` so it can be
 * exercised by scripts and tests; callers pass the request headers explicitly.
 */
import { asc, eq } from "drizzle-orm";

import { db } from "../db";
import { member, organization } from "../db/auth-schema";
import { auth } from "./auth";

export interface ClientOrganization {
  organizationId: string;
  name: string;
  slug: string;
  /** The verified member's role in this organization (e.g. `owner`). */
  role: string;
}

/**
 * Resolves the organization associated with a verified user ID through the
 * user's own membership rows. This is the only organization-scoped lookup
 * used by client-facing routes; it cannot be pointed at another tenant
 * because it accepts no organization identifier at all.
 *
 * Multiple memberships are not created by the approved provisioning flow
 * (exactly one organization per client); if any exist, the oldest membership
 * is resolved deterministically so the result never depends on row order.
 */
export async function resolveClientOrganization(
  userId: string,
): Promise<ClientOrganization | null> {
  const rows = await db
    .select({
      organizationId: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt), asc(organization.id))
    .limit(1);
  return rows[0] ?? null;
}

export interface WorkspaceUser {
  id: string;
  email: string;
  name: string;
}

export type WorkspaceAccess =
  | { status: "unauthenticated" }
  | { status: "no-membership"; user: WorkspaceUser }
  | {
      status: "member";
      user: WorkspaceUser;
      organization: ClientOrganization;
    };

/**
 * Resolves what a request may see in the client workspace: the verified
 * session user and, when one exists, the organization resolved from the
 * user's own membership. Never trusts client input.
 */
export async function resolveWorkspaceAccess(
  requestHeaders: Headers,
): Promise<WorkspaceAccess> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return { status: "unauthenticated" };
  }

  const user: WorkspaceUser = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };

  const organization = await resolveClientOrganization(session.user.id);
  if (!organization) {
    return { status: "no-membership", user };
  }

  return { status: "member", user, organization };
}
