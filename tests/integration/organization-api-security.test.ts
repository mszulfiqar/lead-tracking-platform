import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { invitation, member, organization, user } from "../../src/db/auth-schema";
import { auth } from "../../src/lib/auth";
import { resolveOperatorAccess } from "../../src/lib/operator-access";
import {
  createTestAccount,
  deleteTestAccounts,
  getFromAuthApi,
  postToAuthApi,
  uniqueTestEmail,
  type AuthApiResponse,
  type CreatedTestAccount,
} from "../helpers/auth-test-helpers";

/**
 * Organization API security regression tests (Batch 4E; extended in 4G).
 *
 * These tests audit the real organization endpoints exposed by the installed
 * Better Auth organization plugin through the real `/api/auth/*` handler,
 * using real signed-in sessions and the dedicated test database.
 *
 * Product policy under test:
 * - Clients cannot create their own organizations through public registration
 *   or organization APIs; only the server-side operator provisioning flow
 *   creates organizations and owner memberships.
 * - Client access is limited to organizations where the session user has a
 *   verified membership; client-supplied organization IDs are never proof of
 *   authorization.
 * - Clients gain no control over organization settings, members, invitations,
 *   or roles through the public organization API; those management endpoints
 *   are disabled at the Better Auth HTTP router (server-side APIs remain
 *   available to trusted operator code, which never uses the HTTP routes for
 *   provisioning).
 * - Organization lookups do not disclose whether another tenant's workspace
 *   exists: for an explicit organization target, non-members and unknown
 *   targets receive one identical 403 (see `organization-lookup-guard.ts`).
 * - Organization membership and organization roles never grant platform
 *   operator privileges; those come only from `PLATFORM_OPERATOR_USER_IDS`.
 *
 * Fixtures use two full tenants (A and B) plus a dedicated tenant for mutation
 * attempts, an org member, a non-member, and an invitation recipient.
 */

interface StoredOrganization {
  id: string;
  name: string;
  slug: string;
}

const createdEmails: string[] = [];
const createdOrganizationSlugs: string[] = [];

let ownerA: CreatedTestAccount;
let ownerB: CreatedTestAccount;
let mutationOwner: CreatedTestAccount;
let orgMember: CreatedTestAccount;
let victimMember: CreatedTestAccount;
let outsider: CreatedTestAccount;
let invitee: CreatedTestAccount;
let provisionedOwner: CreatedTestAccount;

let organizationA: StoredOrganization;
let organizationB: StoredOrganization;
let organizationMutation: StoredOrganization;

let headersA: Headers;
let headersB: Headers;
let headersMutationOwner: Headers;
let headersOrgMember: Headers;
let headersVictimMember: Headers;
let headersOutsider: Headers;

let orgMemberRowId: string;
let victimMemberRowId: string;
let cancelProbeInvitationId: string;
let recipientProbeInvitationId: string;

function uniqueOrganizationSlug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function signInHeaders(
  email: string,
  password: string,
): Promise<Headers> {
  const response = await postToAuthApi("/sign-in/email", { email, password });
  if (!response.cookieHeader) {
    throw new Error("Test setup failed: account could not sign in.");
  }
  return new Headers({ cookie: response.cookieHeader });
}

function cookieOf(headers: Headers): string {
  const cookie = headers.get("cookie");
  if (!cookie) throw new Error("Test setup failed: missing session cookie.");
  return cookie;
}

async function findOrganizationBySlug(
  slug: string,
): Promise<StoredOrganization | null> {
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
}

async function findOrganizationById(
  id: string,
): Promise<StoredOrganization | null> {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(organization)
    .where(eq(organization.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function findMembership(
  organizationId: string,
  userId: string,
): Promise<{ id: string; role: string } | null> {
  const rows = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findInvitationByEmail(organizationId: string, email: string) {
  const rows = await db
    .select({ id: invitation.id, status: invitation.status })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, organizationId),
        eq(invitation.email, email),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Asserts the V-1 property for one (existing, unknown) request pair: both
 * answers are the same 403 with byte-identical bodies and no session cookie.
 */
function expectUniformRejection(
  existing: AuthApiResponse,
  missing: AuthApiResponse,
): void {
  expect(existing.status).toBe(403);
  expect(missing.status).toBe(403);
  expect(missing.body).toEqual(existing.body);
  expect(missing.cookieHeader).toBe(existing.cookieHeader);
  expect(existing.cookieHeader).toBeNull();
}

/** A slug that cannot belong to any organization in the test database. */
function missingOrganizationSlug(): string {
  return `org-api-missing-${randomUUID().slice(0, 8)}`;
}

async function createServerSideOrganization(
  name: string,
  slug: string,
  ownerUserId: string,
): Promise<StoredOrganization> {
  const created = await auth.api.createOrganization({
    body: { name, slug, userId: ownerUserId },
  });
  if (!created?.id) throw new Error("Test setup failed: no organization created.");
  createdOrganizationSlugs.push(slug);
  return { id: created.id, name, slug };
}

beforeAll(async () => {
  ownerA = await createTestAccount({
    password: "org-api-owner-a-password-1",
    name: "Org API Owner A",
  });
  ownerB = await createTestAccount({
    password: "org-api-owner-b-password-1",
    name: "Org API Owner B",
  });
  mutationOwner = await createTestAccount({
    password: "org-api-mutation-owner-password-1",
    name: "Org API Mutation Owner",
  });
  orgMember = await createTestAccount({
    password: "org-api-member-password-1",
    name: "Org API Member",
  });
  victimMember = await createTestAccount({
    password: "org-api-victim-password-1",
    name: "Org API Victim Member",
  });
  outsider = await createTestAccount({
    password: "org-api-outsider-password-1",
    name: "Org API Outsider",
  });
  invitee = await createTestAccount({
    password: "org-api-invitee-password-1",
    name: "Org API Invitee",
  });
  provisionedOwner = await createTestAccount({
    password: "org-api-provisioned-password-1",
    name: "Org API Provisioned Owner",
  });

  createdEmails.push(
    ownerA.email,
    ownerB.email,
    mutationOwner.email,
    orgMember.email,
    victimMember.email,
    outsider.email,
    invitee.email,
    provisionedOwner.email,
  );

  organizationA = await createServerSideOrganization(
    "Org API Tenant A",
    uniqueOrganizationSlug("org-api-a"),
    ownerA.id,
  );
  organizationB = await createServerSideOrganization(
    "Org API Tenant B",
    uniqueOrganizationSlug("org-api-b"),
    ownerB.id,
  );
  organizationMutation = await createServerSideOrganization(
    "Org API Mutation Tenant",
    uniqueOrganizationSlug("org-api-mutation"),
    mutationOwner.id,
  );

  // Plain memberships are added through the plugin's server-only member API,
  // which is the same trusted server path the operator uses. It is never
  // reachable over HTTP (verified below).
  await auth.api.addMember({
    body: {
      organizationId: organizationA.id,
      userId: orgMember.id,
      role: "member",
    },
  });
  await auth.api.addMember({
    body: {
      organizationId: organizationMutation.id,
      userId: victimMember.id,
      role: "member",
    },
  });

  headersA = await signInHeaders(ownerA.email, ownerA.password);
  headersB = await signInHeaders(ownerB.email, ownerB.password);
  headersMutationOwner = await signInHeaders(
    mutationOwner.email,
    mutationOwner.password,
  );
  headersOrgMember = await signInHeaders(orgMember.email, orgMember.password);
  headersVictimMember = await signInHeaders(
    victimMember.email,
    victimMember.password,
  );
  headersOutsider = await signInHeaders(outsider.email, outsider.password);

  const orgMemberRow = await findMembership(organizationA.id, orgMember.id);
  const victimMemberRow = await findMembership(
    organizationMutation.id,
    victimMember.id,
  );
  if (!orgMemberRow || !victimMemberRow) {
    throw new Error("Test setup failed: member rows were not created.");
  }
  orgMemberRowId = orgMemberRow.id;
  victimMemberRowId = victimMemberRow.id;

  // Seeded invitations go through the server-side API with the owner's
  // request headers. This is trusted server code, not the public HTTP route,
  // and proves server-side capability survives the HTTP restriction.
  const cancelProbe = await auth.api.createInvitation({
    headers: headersMutationOwner,
    body: {
      organizationId: organizationMutation.id,
      email: uniqueTestEmail("org-api-cancel-probe"),
      role: "member",
    },
  });
  const recipientProbe = await auth.api.createInvitation({
    headers: headersMutationOwner,
    body: {
      organizationId: organizationMutation.id,
      email: invitee.email,
      role: "member",
    },
  });
  if (!cancelProbe?.id || !recipientProbe?.id) {
    throw new Error("Test setup failed: invitations were not created.");
  }
  cancelProbeInvitationId = cancelProbe.id;
  recipientProbeInvitationId = recipientProbe.id;
});

afterAll(async () => {
  // Deleting each organization cascades to its members and invitations.
  if (createdOrganizationSlugs.length > 0) {
    await db
      .delete(organization)
      .where(inArray(organization.slug, createdOrganizationSlugs));
  }
  await deleteTestAccounts(createdEmails);
});

describe("1. Public client organization creation is blocked", () => {
  it("rejects unauthenticated organization creation and creates nothing", async () => {
    const slug = uniqueOrganizationSlug("org-api-unauth");
    createdOrganizationSlugs.push(slug);

    const response = await postToAuthApi("/organization/create", {
      name: "Unauthenticated Organization",
      slug,
    });

    expect(response.status).toBe(401);
    await expect(findOrganizationBySlug(slug)).resolves.toBeNull();
  });

  it("rejects a signed-in client even when forging another user's ID in the body", async () => {
    const slug = uniqueOrganizationSlug("org-api-forged");
    createdOrganizationSlugs.push(slug);

    // The forged `userId` must not turn the signed-in client into a system
    // actor: with a session present the plugin ignores it, and
    // `allowUserToCreateOrganization: false` denies the request.
    const response = await postToAuthApi(
      "/organization/create",
      { name: "Forged Organization", slug, userId: ownerA.id },
      cookieOf(headersOutsider),
    );

    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).toContain(
      "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION",
    );
    await expect(findOrganizationBySlug(slug)).resolves.toBeNull();

    // The caller gained no membership through the attempt.
    const memberships = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, outsider.id));
    expect(memberships).toHaveLength(0);
  });
});

describe("2. Cross-tenant organization access is denied", () => {
  it("denies reading another tenant's organization by ID and by slug", async () => {
    const byId = await getFromAuthApi(
      `/organization/get-organization?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersB),
    );
    expect(byId.status).toBe(403);
    expect(JSON.stringify(byId.body)).not.toContain(organizationA.name);
    expect(JSON.stringify(byId.body)).not.toContain(organizationA.slug);

    const bySlug = await getFromAuthApi(
      `/organization/get-organization?organizationSlug=${encodeURIComponent(organizationA.slug)}`,
      cookieOf(headersB),
    );
    expect(bySlug.status).toBe(403);
    expect(JSON.stringify(bySlug.body)).not.toContain(organizationA.name);
  });

  it("denies reading another tenant's full organization and member list", async () => {
    const full = await getFromAuthApi(
      `/organization/get-full-organization?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersB),
    );
    expect(full.status).toBe(403);
    expect(JSON.stringify(full.body)).not.toContain(organizationA.name);

    const members = await getFromAuthApi(
      `/organization/list-members?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersB),
    );
    expect(members.status).toBe(403);
    expect(JSON.stringify(members.body)).not.toContain(ownerA.email);
  });

  it("denies listing another tenant's invitations and member roles", async () => {
    const invitations = await getFromAuthApi(
      `/organization/list-invitations?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersB),
    );
    expect(invitations.status).toBe(403);

    const role = await getFromAuthApi(
      `/organization/get-active-member-role?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersB),
    );
    expect(role.status).toBe(403);
  });

  it("denies activating another tenant's organization", async () => {
    // Positive control: B can activate its own organization.
    const ownActivation = await postToAuthApi(
      "/organization/set-active",
      { organizationId: organizationB.id },
      cookieOf(headersB),
    );
    expect(ownActivation.status).toBe(200);
    const ownRead = await getFromAuthApi(
      "/organization/get-organization",
      cookieOf(headersB),
    );
    expect((ownRead.body as { id?: string } | null)?.id).toBe(organizationB.id);

    // Cross-tenant activation is rejected and A never becomes B's active org.
    const attempt = await postToAuthApi(
      "/organization/set-active",
      { organizationId: organizationA.id },
      cookieOf(headersB),
    );
    expect(attempt.status).toBe(403);

    const after = await getFromAuthApi(
      "/organization/get-organization",
      cookieOf(headersB),
    );
    expect((after.body as { id?: string } | null)?.id ?? null).not.toBe(
      organizationA.id,
    );
  });

  it("denies cross-tenant metadata changes, deletions, member changes, and invitations", async () => {
    const attemptedInviteEmail = uniqueTestEmail("org-api-cross-tenant-invite");

    const attempts = [
      await postToAuthApi(
        "/organization/update",
        { organizationId: organizationA.id, data: { name: "Cross Tenant Rename" } },
        cookieOf(headersB),
      ),
      await postToAuthApi(
        "/organization/delete",
        { organizationId: organizationA.id },
        cookieOf(headersB),
      ),
      await postToAuthApi(
        "/organization/invite-member",
        {
          organizationId: organizationA.id,
          email: attemptedInviteEmail,
          role: "member",
        },
        cookieOf(headersB),
      ),
      await postToAuthApi(
        "/organization/remove-member",
        { organizationId: organizationA.id, memberIdOrEmail: ownerA.email },
        cookieOf(headersB),
      ),
      await postToAuthApi(
        "/organization/update-member-role",
        { organizationId: organizationA.id, memberId: orgMemberRowId, role: "owner" },
        cookieOf(headersB),
      ),
      await postToAuthApi(
        "/organization/cancel-invitation",
        { invitationId: recipientProbeInvitationId },
        cookieOf(headersB),
      ),
    ];

    for (const attempt of attempts) {
      expect(attempt.status).toBeGreaterThanOrEqual(400);
    }

    // Tenant A is completely unchanged.
    const storedA = await findOrganizationById(organizationA.id);
    expect(storedA?.name).toBe(organizationA.name);
    expect(storedA?.slug).toBe(organizationA.slug);
    await expect(
      findInvitationByEmail(organizationA.id, attemptedInviteEmail),
    ).resolves.toBeNull();
    const ownerMembership = await findMembership(organizationA.id, ownerA.id);
    expect(ownerMembership?.role).toBe("owner");
  });

  it("denies permission probing against another tenant", async () => {
    const response = await postToAuthApi(
      "/organization/has-permission",
      {
        organizationId: organizationA.id,
        permissions: { organization: ["update"] },
      },
      cookieOf(headersB),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(
      (response.body as { success?: boolean } | null)?.success,
    ).not.toBe(true);
  });

  it("ignores organization IDs injected through headers", async () => {
    // Re-activate B's own organization (cross-tenant reads above clear the
    // active organization as a fail-safe), then inject A's ID as headers.
    await postToAuthApi(
      "/organization/set-active",
      { organizationId: organizationB.id },
      cookieOf(headersB),
    );

    const response = await getFromAuthApi(
      "/organization/get-organization",
      cookieOf(headersB),
      {
        "x-organization-id": organizationA.id,
        "x-organization-slug": organizationA.slug,
        organizationid: organizationA.id,
      },
    );

    expect(response.status).toBe(200);
    const body = response.body as { id?: string; slug?: string } | null;
    expect(body?.id).toBe(organizationB.id);
    expect(body?.slug).toBe(organizationB.slug);
    expect(JSON.stringify(response.body)).not.toContain(organizationA.slug);
  });
});

describe("3. Organization membership grants no operator privileges", () => {
  it("keeps organization owners at the default account role", async () => {
    const rows = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(
        inArray(user.email, [
          ownerA.email,
          ownerB.email,
          mutationOwner.email,
        ]),
      );

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.role).toBe("user");
    }
  });

  it("does not authorize an organization owner as a platform operator", async () => {
    // Owner A has an organization role of `owner` and a valid session, but
    // operator access depends exclusively on the allowlist.
    const denied = await resolveOperatorAccess(headersA, ownerB.id);
    expect(denied.status).toBe("denied");

    const authorized = await resolveOperatorAccess(headersA, ownerA.id);
    expect(authorized.status).toBe("operator");
  });
});

describe("4. Invitation operations stay recipient-bound; a sole owner cannot orphan the organization", () => {
  it("denies getting, accepting, or rejecting another user's invitation", async () => {
    const getAttempt = await getFromAuthApi(
      `/organization/get-invitation?id=${encodeURIComponent(recipientProbeInvitationId)}`,
      cookieOf(headersOutsider),
    );
    expect(getAttempt.status).toBe(403);
    expect(JSON.stringify(getAttempt.body)).toContain(
      "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
    );

    const acceptAttempt = await postToAuthApi(
      "/organization/accept-invitation",
      { invitationId: recipientProbeInvitationId },
      cookieOf(headersOutsider),
    );
    expect(acceptAttempt.status).toBe(403);

    const rejectAttempt = await postToAuthApi(
      "/organization/reject-invitation",
      { invitationId: recipientProbeInvitationId },
      cookieOf(headersOutsider),
    );
    expect(rejectAttempt.status).toBe(403);

    // The invitation is untouched and the non-recipient gained no membership.
    const stored = await findInvitationByEmail(
      organizationMutation.id,
      invitee.email,
    );
    expect(stored?.status).toBe("pending");
    const memberships = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, outsider.id));
    expect(memberships).toHaveLength(0);
  });

  it("denies a sole owner leaving the organization", async () => {
    const response = await postToAuthApi(
      "/organization/leave",
      { organizationId: organizationA.id },
      cookieOf(headersA),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).toContain("ONLY_OWNER");
    await expect(findMembership(organizationA.id, ownerA.id)).resolves.toMatchObject(
      { role: "owner" },
    );
  });
});

describe("5. Organization management endpoints are not reachable to clients", () => {
  it("returns 404 for the server-only add-member endpoint", async () => {
    const response = await postToAuthApi(
      "/organization/add-member",
      {
        organizationId: organizationMutation.id,
        userId: outsider.id,
        role: "member",
      },
      cookieOf(headersMutationOwner),
    );

    expect(response.status).toBe(404);
    await expect(
      findMembership(organizationMutation.id, outsider.id),
    ).resolves.toBeNull();
  });

  it("denies a plain member managing the organization, members, roles, or invitations", async () => {
    const attemptedInviteEmail = uniqueTestEmail("org-api-member-invite");

    const updateAttempt = await postToAuthApi(
      "/organization/update",
      { organizationId: organizationMutation.id, data: { name: "Member Rename" } },
      cookieOf(headersVictimMember),
    );
    const deleteAttempt = await postToAuthApi(
      "/organization/delete",
      { organizationId: organizationMutation.id },
      cookieOf(headersVictimMember),
    );
    const inviteAttempt = await postToAuthApi(
      "/organization/invite-member",
      {
        organizationId: organizationMutation.id,
        email: attemptedInviteEmail,
        role: "member",
      },
      cookieOf(headersVictimMember),
    );
    const removeAttempt = await postToAuthApi(
      "/organization/remove-member",
      {
        organizationId: organizationMutation.id,
        memberIdOrEmail: mutationOwner.email,
      },
      cookieOf(headersVictimMember),
    );
    const roleAttempt = await postToAuthApi(
      "/organization/update-member-role",
      {
        organizationId: organizationMutation.id,
        memberId: victimMemberRowId,
        role: "owner",
      },
      cookieOf(headersVictimMember),
    );

    for (const attempt of [updateAttempt, deleteAttempt, inviteAttempt, removeAttempt, roleAttempt]) {
      expect(attempt.status).toBeGreaterThanOrEqual(400);
    }

    const stored = await findOrganizationById(organizationMutation.id);
    expect(stored?.name).toBe(organizationMutation.name);
    await expect(
      findInvitationByEmail(organizationMutation.id, attemptedInviteEmail),
    ).resolves.toBeNull();
    await expect(
      findMembership(organizationMutation.id, mutationOwner.id),
    ).resolves.toMatchObject({ role: "owner" });
    await expect(
      findMembership(organizationMutation.id, victimMember.id),
    ).resolves.toMatchObject({ role: "member" });
  });

  it("returns 404 for owner organization updates and leaves the organization unchanged", async () => {
    const response = await postToAuthApi(
      "/organization/update",
      {
        organizationId: organizationMutation.id,
        data: { name: "Renamed By Client Owner" },
      },
      cookieOf(headersMutationOwner),
    );

    expect(response.status).toBe(404);
    const stored = await findOrganizationById(organizationMutation.id);
    expect(stored?.name).toBe(organizationMutation.name);
  });

  it("returns 404 for owner invitation creation and creates no invitation", async () => {
    const attemptedInviteEmail = uniqueTestEmail("org-api-owner-invite");

    const response = await postToAuthApi(
      "/organization/invite-member",
      {
        organizationId: organizationMutation.id,
        email: attemptedInviteEmail,
        role: "member",
      },
      cookieOf(headersMutationOwner),
    );

    expect(response.status).toBe(404);
    await expect(
      findInvitationByEmail(organizationMutation.id, attemptedInviteEmail),
    ).resolves.toBeNull();
  });

  it("returns 404 for owner invitation cancellation and leaves the invitation pending", async () => {
    const response = await postToAuthApi(
      "/organization/cancel-invitation",
      { invitationId: cancelProbeInvitationId },
      cookieOf(headersMutationOwner),
    );

    expect(response.status).toBe(404);
    const stored = await db
      .select({ status: invitation.status })
      .from(invitation)
      .where(eq(invitation.id, cancelProbeInvitationId))
      .limit(1);
    expect(stored[0]?.status).toBe("pending");
  });

  it("returns 404 for owner member-role changes and leaves the role unchanged", async () => {
    const response = await postToAuthApi(
      "/organization/update-member-role",
      {
        organizationId: organizationMutation.id,
        memberId: victimMemberRowId,
        role: "owner",
      },
      cookieOf(headersMutationOwner),
    );

    expect(response.status).toBe(404);
    await expect(
      findMembership(organizationMutation.id, victimMember.id),
    ).resolves.toMatchObject({ role: "member" });
  });

  it("returns 404 for owner member removal and leaves the membership in place", async () => {
    const response = await postToAuthApi(
      "/organization/remove-member",
      {
        organizationId: organizationMutation.id,
        memberIdOrEmail: victimMember.email,
      },
      cookieOf(headersMutationOwner),
    );

    expect(response.status).toBe(404);
    await expect(
      findMembership(organizationMutation.id, victimMember.id),
    ).resolves.toMatchObject({ role: "member" });
  });

  it("returns 404 for slug probing and discloses no tenant slug", async () => {
    const response = await postToAuthApi(
      "/organization/check-slug",
      { slug: organizationA.slug },
      cookieOf(headersOutsider),
    );

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain(organizationA.slug);
  });

  it("returns 404 for owner organization deletion and leaves the organization in place", async () => {
    const response = await postToAuthApi(
      "/organization/delete",
      { organizationId: organizationMutation.id },
      cookieOf(headersMutationOwner),
    );

    expect(response.status).toBe(404);
    await expect(
      findOrganizationById(organizationMutation.id),
    ).resolves.not.toBeNull();
  });
});

describe("6. Legitimate client and provisioning operations still work", () => {
  it("still lets an owner read their own organization and its members", async () => {
    const response = await getFromAuthApi(
      `/organization/get-full-organization?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersA),
    );

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain(organizationA.name);
    expect(serialized).toContain(ownerA.email);
    expect(serialized).not.toContain(organizationB.name);
    expect(serialized).not.toContain(organizationB.slug);
  });

  it("still lists only the caller's own organizations", async () => {
    const response = await getFromAuthApi(
      "/organization/list",
      cookieOf(headersA),
    );

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain(organizationA.slug);
    expect(serialized).not.toContain(organizationB.slug);
  });

  it("still lets a plain member read their own organization", async () => {
    const response = await getFromAuthApi(
      `/organization/get-organization?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersOrgMember),
    );

    expect(response.status).toBe(200);
    expect((response.body as { id?: string } | null)?.id).toBe(
      organizationA.id,
    );
  });

  it("still provisions organizations and owner memberships through the server-side API", async () => {
    const slug = uniqueOrganizationSlug("org-api-provisioned");
    const created = await createServerSideOrganization(
      "Org API Provisioned Tenant",
      slug,
      provisionedOwner.id,
    );

    const membership = await findMembership(created.id, provisionedOwner.id);
    expect(membership?.role).toBe("owner");

    const storedUser = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, provisionedOwner.id))
      .limit(1);
    expect(storedUser[0]?.role).toBe("user");
  });
});

describe("7. Organization lookups disclose no existence information to non-members", () => {
  // V-1 regression tests. Better Auth 1.7.10 answered an existing organization
  // with 403 (membership error) and a nonexistent one with 400
  // ORGANIZATION_NOT_FOUND, letting any signed-in user enumerate tenant slugs
  // and IDs. `organization-lookup-guard.ts` now answers every explicit target
  // with one uniform 403. Each pair below is compared for status, body, and
  // Set-Cookie; timing side channels are out of scope and not claimed.

  it("answers an existing and a nonexistent slug identically on every guarded endpoint", async () => {
    const missingSlug = missingOrganizationSlug();
    const cookie = cookieOf(headersOutsider);

    const pairs: Array<{
      endpoint: string;
      existing: AuthApiResponse;
      missing: AuthApiResponse;
      code: string;
    }> = [];

    for (const path of [
      "/organization/get-organization",
      "/organization/get-full-organization",
      "/organization/list-members",
      "/organization/get-active-member-role",
    ]) {
      const existing = await getFromAuthApi(
        `${path}?organizationSlug=${encodeURIComponent(organizationA.slug)}`,
        cookie,
      );
      const missing = await getFromAuthApi(
        `${path}?organizationSlug=${encodeURIComponent(missingSlug)}`,
        cookie,
      );
      pairs.push({
        endpoint: path,
        existing,
        missing,
        code:
          path === "/organization/list-members" ||
          path === "/organization/get-active-member-role"
            ? "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION"
            : "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
      });
    }

    const setActiveExisting = await postToAuthApi(
      "/organization/set-active",
      { organizationSlug: organizationA.slug },
      cookie,
    );
    const setActiveMissing = await postToAuthApi(
      "/organization/set-active",
      { organizationSlug: missingSlug },
      cookie,
    );
    pairs.push({
      endpoint: "/organization/set-active",
      existing: setActiveExisting,
      missing: setActiveMissing,
      code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
    });

    expect(pairs).toHaveLength(5);
    for (const pair of pairs) {
      expectUniformRejection(pair.existing, pair.missing);
      // The uniform answer carries the endpoint's own membership error and
      // never an existence or tenant-detail signal.
      expect(pair.existing.body).toEqual({
        message:
          pair.code === "YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION"
            ? "You are not a member of this organization"
            : "User is not a member of the organization",
        code: pair.code,
      });
      const serialized = JSON.stringify(pair.existing.body);
      expect(serialized).not.toContain("ORGANIZATION_NOT_FOUND");
      expect(serialized).not.toContain(organizationA.slug);
      expect(serialized).not.toContain(organizationA.name);
      expect(serialized).not.toContain(organizationA.id);
    }
  });

  it("answers an existing and a nonexistent organization ID identically", async () => {
    const missingId = randomUUID();
    const cookie = cookieOf(headersOutsider);

    for (const path of [
      "/organization/get-organization",
      "/organization/get-full-organization",
      "/organization/list-members",
      "/organization/get-active-member-role",
    ]) {
      const existing = await getFromAuthApi(
        `${path}?organizationId=${encodeURIComponent(organizationA.id)}`,
        cookie,
      );
      const missing = await getFromAuthApi(
        `${path}?organizationId=${encodeURIComponent(missingId)}`,
        cookie,
      );
      expectUniformRejection(existing, missing);
    }

    const setActiveExisting = await postToAuthApi(
      "/organization/set-active",
      { organizationId: organizationA.id },
      cookie,
    );
    const setActiveMissing = await postToAuthApi(
      "/organization/set-active",
      { organizationId: missingId },
      cookie,
    );
    expectUniformRejection(setActiveExisting, setActiveMissing);
  });

  it("answers an existing and a nonexistent slug identically for a member of another tenant", async () => {
    // Owner B is a legitimate member of a different organization: the guard
    // must not become a new oracle for them either.
    const missingSlug = missingOrganizationSlug();
    const existing = await getFromAuthApi(
      `/organization/get-full-organization?organizationSlug=${encodeURIComponent(organizationA.slug)}`,
      cookieOf(headersB),
    );
    const missing = await getFromAuthApi(
      `/organization/get-full-organization?organizationSlug=${encodeURIComponent(missingSlug)}`,
      cookieOf(headersB),
    );
    expectUniformRejection(existing, missing);
  });

  it("keeps unauthenticated answers identical (401) for existing and nonexistent slugs", async () => {
    const missingSlug = missingOrganizationSlug();
    const existing = await getFromAuthApi(
      `/organization/get-organization?organizationSlug=${encodeURIComponent(organizationA.slug)}`,
    );
    const missing = await getFromAuthApi(
      `/organization/get-organization?organizationSlug=${encodeURIComponent(missingSlug)}`,
    );

    expect(existing.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(missing.body).toEqual(existing.body);
    expect(existing.cookieHeader).toBeNull();
    expect(missing.cookieHeader).toBeNull();
  });

  it("does not touch the organization when a non-member probes it", async () => {
    const before = await findOrganizationById(organizationA.id);
    await postToAuthApi(
      "/organization/set-active",
      { organizationSlug: organizationA.slug },
      cookieOf(headersOutsider),
    );
    const after = await findOrganizationById(organizationA.id);

    expect(after).toEqual(before);
    await expect(
      findMembership(organizationA.id, outsider.id),
    ).resolves.toBeNull();
  });

  it("still lets members read and activate their own organization", async () => {
    // Owner retains every legitimate read/activation.
    const full = await getFromAuthApi(
      `/organization/get-full-organization?organizationSlug=${encodeURIComponent(organizationA.slug)}`,
      cookieOf(headersA),
    );
    expect(full.status).toBe(200);
    expect((full.body as { id?: string } | null)?.id).toBe(organizationA.id);

    const activated = await postToAuthApi(
      "/organization/set-active",
      { organizationSlug: organizationA.slug },
      cookieOf(headersOrgMember),
    );
    expect(activated.status).toBe(200);
    expect((activated.body as { id?: string } | null)?.id).toBe(
      organizationA.id,
    );

    const members = await getFromAuthApi(
      `/organization/list-members?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersOrgMember),
    );
    expect(members.status).toBe(200);
    expect(JSON.stringify(members.body)).toContain(ownerA.email);

    const role = await getFromAuthApi(
      `/organization/get-active-member-role?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersOrgMember),
    );
    expect(role.status).toBe(200);
    expect((role.body as { role?: string } | null)?.role).toBe("member");

    const byId = await getFromAuthApi(
      `/organization/get-organization?organizationId=${encodeURIComponent(organizationA.id)}`,
      cookieOf(headersOrgMember),
    );
    expect(byId.status).toBe(200);
    expect((byId.body as { id?: string } | null)?.id).toBe(organizationA.id);
  });
});
