import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { member, organization } from "../../src/db/auth-schema";
import { auth } from "../../src/lib/auth";
import {
  createTestAccount,
  deleteTestAccounts,
  findUserByEmail,
  postToAuthApi,
  testAuthOrigin,
} from "../helpers/auth-test-helpers";

/**
 * Runtime verification of the organization plugin (Batch 4A).
 *
 * These tests exercise the actual installed Better Auth behavior in the
 * dedicated test database:
 * - server-side organization creation for a specified user assigns that user
 *   the approved `owner` membership role (no session headers involved),
 * - unauthenticated and signed-in users can never create organizations
 *   through the public HTTP API (`allowUserToCreateOrganization: false`),
 * - an organization is never created unless the operation succeeded.
 */

const createdOrganizationSlugs: string[] = [];
const createdEmails: string[] = [];

function uniqueOrganizationSlug(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function findOrganizationBySlug(slug: string) {
  const rows = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

async function findMembership(organizationId: string, userId: string) {
  const rows = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

afterAll(async () => {
  // Deleting the organization cascades to its members (ON DELETE CASCADE).
  if (createdOrganizationSlugs.length > 0) {
    await db
      .delete(organization)
      .where(inArray(organization.slug, createdOrganizationSlugs));
  }
  await deleteTestAccounts(createdEmails);
});

describe("public organization creation is rejected", () => {
  it("rejects unauthenticated organization creation over the public auth API", async () => {
    const slug = uniqueOrganizationSlug("it-unauth-org");
    const response = await postToAuthApi("/organization/create", {
      name: "Unauthenticated Org",
      slug,
    });

    expect(response.status).toBe(401);
    expect(response.cookieHeader).toBeNull();
    await expect(findOrganizationBySlug(slug)).resolves.toBeNull();
  });

  it("rejects a signed-in client attempting self-service organization creation", async () => {
    const account = await createTestAccount({
      password: "self-service-attempt-password-1",
      name: "Self Service Attempt",
    });
    createdEmails.push(account.email);

    const signIn = await postToAuthApi("/sign-in/email", {
      email: account.email,
      password: account.password,
    });
    expect(signIn.cookieHeader).not.toBeNull();

    const slug = uniqueOrganizationSlug("it-selfservice-org");
    const response = await auth.handler(
      new Request(`${testAuthOrigin()}/api/auth/organization/create`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: testAuthOrigin(),
          cookie: signIn.cookieHeader ?? "",
        },
        body: JSON.stringify({ name: "Self Service Org", slug }),
      }),
    );

    expect(response.status).toBe(403);
    const body = await response.json().catch(() => null);
    expect(JSON.stringify(body)).toContain(
      "YOU_ARE_NOT_ALLOWED_TO_CREATE_A_NEW_ORGANIZATION",
    );
    await expect(findOrganizationBySlug(slug)).resolves.toBeNull();

    // The account gained no membership anywhere.
    const memberships = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, account.id));
    expect(memberships).toHaveLength(0);
  });
});

describe("server-side organization creation", () => {
  it("creates an organization for a specified user and assigns the owner membership", async () => {
    const account = await createTestAccount({
      password: "provisioned-owner-password-1",
      name: "Provisioned Owner",
    });
    createdEmails.push(account.email);

    const slug = uniqueOrganizationSlug("it-server-org");
    createdOrganizationSlugs.push(slug);

    // Called on the server without session headers: the specified user
    // becomes the organization creator and receives the `owner` role.
    const created = await auth.api.createOrganization({
      body: { name: "Server Side Org", slug, userId: account.id },
    });

    expect(created?.id).toBeTruthy();

    const storedOrganization = await findOrganizationBySlug(slug);
    expect(storedOrganization?.id).toBe(created.id);
    expect(storedOrganization?.name).toBe("Server Side Org");

    const membership = await findMembership(created.id, account.id);
    expect(membership?.role).toBe("owner");

    // The account keeps the default client role; organization ownership never
    // grants platform-operator privileges (those come only from the
    // PLATFORM_OPERATOR_USER_IDS allowlist).
    const storedUser = await findUserByEmail(account.email);
    expect(storedUser?.role).toBe("user");
  });
});
