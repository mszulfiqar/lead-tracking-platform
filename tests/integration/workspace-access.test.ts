import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { organization } from "../../src/db/auth-schema";
import { auth } from "../../src/lib/auth";
import {
  resolveClientOrganization,
  resolveWorkspaceAccess,
} from "../../src/lib/organization-access";
import {
  createTestAccount,
  deleteTestAccounts,
  postToAuthApi,
  type CreatedTestAccount,
} from "../helpers/auth-test-helpers";

/**
 * Integration tests for server-side organization resolution and tenant
 * isolation (Batch 4C) against the real Better Auth APIs and the dedicated
 * test database.
 *
 * These are the security tests behind the `/workspace` route: the tenant is
 * resolved exclusively from the verified session user's own membership rows,
 * client-supplied organization identifiers are never evidence of
 * authorization, and users without a verified membership get nothing.
 */

const createdEmails: string[] = [];
const createdOrganizationSlugs: string[] = [];

let ownerA: CreatedTestAccount;
let ownerB: CreatedTestAccount;
let nonMember: CreatedTestAccount;
let organizationA: { id: string; name: string; slug: string };
let organizationB: { id: string; name: string; slug: string };
let headersA: Headers;
let headersB: Headers;
let nonMemberHeaders: Headers;

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

beforeAll(async () => {
  ownerA = await createTestAccount({
    password: "workspace-owner-a-password-1",
    name: "Workspace Owner A",
  });
  ownerB = await createTestAccount({
    password: "workspace-owner-b-password-1",
    name: "Workspace Owner B",
  });
  nonMember = await createTestAccount({
    password: "workspace-non-member-password-1",
    name: "Workspace Non Member",
  });
  createdEmails.push(ownerA.email, ownerB.email, nonMember.email);

  // Organizations are created through the supported server-side API with the
  // specified user as creator, which grants the verified `owner` membership
  // (same path the provisioning service uses).
  const slugA = `it-workspace-a-${randomUUID().slice(0, 8)}`;
  const slugB = `it-workspace-b-${randomUUID().slice(0, 8)}`;
  createdOrganizationSlugs.push(slugA, slugB);

  const createdA = await auth.api.createOrganization({
    body: { name: "Workspace A HVAC", slug: slugA, userId: ownerA.id },
  });
  const createdB = await auth.api.createOrganization({
    body: { name: "Workspace B HVAC", slug: slugB, userId: ownerB.id },
  });
  organizationA = { id: createdA.id, name: "Workspace A HVAC", slug: slugA };
  organizationB = { id: createdB.id, name: "Workspace B HVAC", slug: slugB };

  headersA = await signInHeaders(ownerA.email, ownerA.password);
  headersB = await signInHeaders(ownerB.email, ownerB.password);
  nonMemberHeaders = await signInHeaders(nonMember.email, nonMember.password);
});

afterAll(async () => {
  if (createdOrganizationSlugs.length > 0) {
    await db
      .delete(organization)
      .where(inArray(organization.slug, createdOrganizationSlugs));
  }
  await deleteTestAccounts(createdEmails);
});

describe("resolveWorkspaceAccess", () => {
  it("resolves the member's own organization from the verified session", async () => {
    const access = await resolveWorkspaceAccess(headersA);

    expect(access.status).toBe("member");
    if (access.status !== "member") return;
    expect(access.user.id).toBe(ownerA.id);
    expect(access.user.email).toBe(ownerA.email);
    expect(access.organization.organizationId).toBe(organizationA.id);
    expect(access.organization.name).toBe(organizationA.name);
    expect(access.organization.slug).toBe(organizationA.slug);
    expect(access.organization.role).toBe("owner");
  });

  it("resolves each member to exactly their own tenant", async () => {
    const accessA = await resolveWorkspaceAccess(headersA);
    const accessB = await resolveWorkspaceAccess(headersB);

    // Neither member can see the other organization anywhere in their
    // resolved access.
    expect(JSON.stringify(accessA)).not.toContain(organizationB.id);
    expect(JSON.stringify(accessA)).not.toContain(organizationB.slug);
    expect(JSON.stringify(accessB)).not.toContain(organizationA.id);
    expect(JSON.stringify(accessB)).not.toContain(organizationA.slug);

    expect(accessB.status).toBe("member");
    if (accessB.status === "member") {
      expect(accessB.organization.organizationId).toBe(organizationB.id);
      expect(accessB.organization.slug).toBe(organizationB.slug);
    }
  });

  it("ignores client-supplied organization identifiers entirely", async () => {
    // A hostile client adds the other tenant's identifiers as headers; the
    // resolved organization must still be the member's own.
    const tamperedHeaders = new Headers(headersA);
    tamperedHeaders.set("x-organization-id", organizationB.id);
    tamperedHeaders.set("x-organization-slug", organizationB.slug);
    tamperedHeaders.set("organizationId", organizationB.id);

    const access = await resolveWorkspaceAccess(tamperedHeaders);
    expect(access.status).toBe("member");
    if (access.status !== "member") return;
    expect(access.organization.organizationId).toBe(organizationA.id);
    expect(access.organization.slug).toBe(organizationA.slug);
    expect(access.organization.name).toBe(organizationA.name);
  });

  it("grants nothing to a signed-in user without a membership", async () => {
    const access = await resolveWorkspaceAccess(nonMemberHeaders);

    expect(access.status).toBe("no-membership");
    if (access.status !== "no-membership") return;
    expect(access.user.id).toBe(nonMember.id);
    // No organization data is disclosed.
    const serialized = JSON.stringify(access);
    expect(serialized).not.toContain(organizationA.id);
    expect(serialized).not.toContain(organizationB.id);
  });

  it("treats missing or forged sessions as unauthenticated", async () => {
    await expect(resolveWorkspaceAccess(new Headers())).resolves.toEqual({
      status: "unauthenticated",
    });

    const forged = new Headers({
      cookie: "better-auth.session_token=forged-session-value",
    });
    await expect(resolveWorkspaceAccess(forged)).resolves.toEqual({
      status: "unauthenticated",
    });
  });
});

describe("resolveClientOrganization", () => {
  it("returns the user's own organization by verified user ID", async () => {
    const resolvedA = await resolveClientOrganization(ownerA.id);
    const resolvedB = await resolveClientOrganization(ownerB.id);

    expect(resolvedA?.organizationId).toBe(organizationA.id);
    expect(resolvedA?.slug).toBe(organizationA.slug);
    expect(resolvedA?.role).toBe("owner");
    expect(resolvedB?.organizationId).toBe(organizationB.id);
    expect(resolvedB?.slug).toBe(organizationB.slug);
  });

  it("returns null for a user with no membership", async () => {
    expect(await resolveClientOrganization(nonMember.id)).toBeNull();
  });

  it("returns null for an unknown user ID", async () => {
    expect(await resolveClientOrganization(`missing-${randomUUID()}`)).toBeNull();
  });

  it("has no parameter through which another tenant could be selected", () => {
    // Structural guarantee: the lookup accepts only a user ID. There is no
    // organization argument, URL, or body that a client could influence.
    expect(resolveClientOrganization.length).toBe(1);
  });
});
