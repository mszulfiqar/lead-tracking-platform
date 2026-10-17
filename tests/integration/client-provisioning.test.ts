import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { account, member, organization } from "../../src/db/auth-schema";
import { provisionClientWorkspaceForRequest } from "../../src/lib/client-provisioning-server";
import {
  createTestAccount,
  deleteTestAccounts,
  findUserByEmail,
  getSessionForCookie,
  postToAuthApi,
  uniqueTestEmail,
  type CreatedTestAccount,
} from "../helpers/auth-test-helpers";

/**
 * End-to-end verification of operator-managed client provisioning (Batch 4B)
 * against the real Better Auth APIs and the dedicated test database.
 *
 * Covered here: successful provisioning with verified owner membership, the
 * initial password signing in while the stored credential stays hashed,
 * account-level role remaining `user`, duplicate email and slug conflicts,
 * invalid input, and unauthorized callers having no side effects.
 *
 * Failure injection at each provisioning stage (API/database errors, partial
 * failures, compensation) is covered by the dependency-injected unit tests in
 * `tests/unit/client-provisioning.test.ts`; this file exercises the real
 * server wiring.
 */

const createdEmails: string[] = [];
const createdOrganizationSlugs: string[] = [];
const originalOperatorAllowlist = process.env.PLATFORM_OPERATOR_USER_IDS;

let operator: CreatedTestAccount;
let operatorHeaders: Headers;

async function findOrganizationBySlug(slug: string) {
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

async function membershipRoleFor(organizationId: string, userId: string) {
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
}

async function signInHeaders(
  email: string,
  password: string,
): Promise<Headers> {
  const response = await postToAuthApi("/sign-in/email", { email, password });
  expect(response.cookieHeader).not.toBeNull();
  return new Headers({ cookie: response.cookieHeader ?? "" });
}

beforeAll(async () => {
  operator = await createTestAccount({
    password: "operator-provisioning-password-1",
    name: "Provisioning Operator",
  });
  createdEmails.push(operator.email);
  operatorHeaders = await signInHeaders(operator.email, operator.password);
  process.env.PLATFORM_OPERATOR_USER_IDS = operator.id;
});

afterAll(async () => {
  if (originalOperatorAllowlist === undefined) {
    delete process.env.PLATFORM_OPERATOR_USER_IDS;
  } else {
    process.env.PLATFORM_OPERATOR_USER_IDS = originalOperatorAllowlist;
  }
  // Deleting the organizations cascades to their members; deleting the
  // accounts cascades to their credentials and sessions.
  if (createdOrganizationSlugs.length > 0) {
    await db
      .delete(organization)
      .where(inArray(organization.slug, createdOrganizationSlugs));
  }
  await deleteTestAccounts(createdEmails);
});

describe("operator provisions a client workspace", () => {
  it("creates the organization and owner account, and the initial password signs in", async () => {
    const suffix = randomUUID().slice(0, 8);
    const companyName = `Northwind Mechanical ${suffix}`;
    const expectedSlug = `northwind-mechanical-${suffix}`;
    const ownerEmail = uniqueTestEmail("client-owner");
    const ownerPassword = "client-initial-password-1";
    createdEmails.push(ownerEmail);
    createdOrganizationSlugs.push(expectedSlug);

    const result = await provisionClientWorkspaceForRequest(operatorHeaders, {
      companyName,
      ownerName: "Client Owner",
      // Uppercase input must normalize to the stored lowercase email.
      ownerEmail: ownerEmail.toUpperCase(),
      initialPassword: ownerPassword,
    });

    if (result.status !== "provisioned") {
      throw new Error(`Expected provisioning to succeed: ${JSON.stringify(result)}`);
    }
    expect(result.organizationSlug).toBe(expectedSlug);
    expect(result.organizationName).toBe(companyName);
    expect(result.ownerEmail).toBe(ownerEmail);
    expect(result.ownerMembershipRole).toBe("owner");

    // The persisted organization matches the verified result.
    const storedOrganization = await findOrganizationBySlug(expectedSlug);
    expect(storedOrganization?.id).toBe(result.organizationId);
    expect(storedOrganization?.name).toBe(companyName);

    // The client account keeps the default `user` role and the approved
    // `owner` membership in exactly this organization.
    const storedUser = await findUserByEmail(ownerEmail);
    expect(storedUser?.id).toBe(result.ownerUserId);
    expect(storedUser?.role).toBe("user");
    const membership = await membershipRoleFor(
      result.organizationId,
      result.ownerUserId,
    );
    expect(membership?.role).toBe("owner");

    // The stored credential is a hash, never the plaintext password.
    const credentials = await db
      .select({ providerId: account.providerId, password: account.password })
      .from(account)
      .where(eq(account.userId, result.ownerUserId));
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.providerId).toBe("credential");
    const storedHash = credentials[0]?.password ?? "";
    expect(storedHash.length).toBeGreaterThan(0);
    expect(storedHash).not.toBe(ownerPassword);
    expect(storedHash).not.toContain(ownerPassword);

    // The password is never echoed back through the result.
    expect(JSON.stringify(result)).not.toContain(ownerPassword);

    // A wrong password cannot sign in; the initial password can.
    const wrongPassword = await postToAuthApi("/sign-in/email", {
      email: ownerEmail,
      password: "definitely-not-the-initial-password",
    });
    expect(wrongPassword.status).toBeGreaterThanOrEqual(400);
    expect(wrongPassword.cookieHeader).toBeNull();

    const signIn = await postToAuthApi("/sign-in/email", {
      email: ownerEmail,
      password: ownerPassword,
    });
    expect(signIn.status).toBe(200);
    expect(signIn.cookieHeader).not.toBeNull();
    const session = await getSessionForCookie(signIn.cookieHeader ?? "");
    expect(session?.user.id).toBe(result.ownerUserId);
    expect(session?.user.email).toBe(ownerEmail);
  });

  it("reports a duplicate email conflict without creating anything", async () => {
    const existing = await createTestAccount({
      password: "existing-owner-password-1",
      name: "Existing Owner",
    });
    createdEmails.push(existing.email);
    const slug = `it-duplicate-email-${randomUUID().slice(0, 8)}`;
    createdOrganizationSlugs.push(slug);

    const result = await provisionClientWorkspaceForRequest(operatorHeaders, {
      companyName: "Duplicate Email HVAC",
      organizationSlug: slug,
      ownerName: "New Owner",
      ownerEmail: existing.email.toUpperCase(),
      initialPassword: "another-initial-password-1",
    });

    expect(result).toMatchObject({ status: "conflict", field: "owner_email" });
    expect(await findOrganizationBySlug(slug)).toBeNull();
    // The existing account is untouched.
    const stored = await findUserByEmail(existing.email);
    expect(stored?.id).toBe(existing.id);
  });

  it("reports a duplicate slug conflict without creating anything", async () => {
    const firstEmail = uniqueTestEmail("client-owner");
    const slug = `it-duplicate-slug-${randomUUID().slice(0, 8)}`;
    createdEmails.push(firstEmail);
    createdOrganizationSlugs.push(slug);

    const first = await provisionClientWorkspaceForRequest(operatorHeaders, {
      companyName: "First Client HVAC",
      organizationSlug: slug,
      ownerName: "First Owner",
      ownerEmail: firstEmail,
      initialPassword: "first-client-password-1",
    });
    expect(first.status).toBe("provisioned");

    const secondEmail = uniqueTestEmail("client-owner");
    createdEmails.push(secondEmail);
    const second = await provisionClientWorkspaceForRequest(operatorHeaders, {
      companyName: "Second Client HVAC",
      organizationSlug: slug,
      ownerName: "Second Owner",
      ownerEmail: secondEmail,
      initialPassword: "second-client-password-1",
    });

    expect(second).toMatchObject({ status: "conflict", field: "slug" });
    if (second.status === "conflict") {
      expect(second.message).toContain(slug);
    }
    expect(await findUserByEmail(secondEmail)).toBeNull();
    expect((await findOrganizationBySlug(slug))?.name).toBe("First Client HVAC");
  });

  it("rejects invalid input at the real boundary without creating anything", async () => {
    const ownerEmail = uniqueTestEmail("client-owner");
    const slug = `it-invalid-input-${randomUUID().slice(0, 8)}`;
    createdEmails.push(ownerEmail);
    createdOrganizationSlugs.push(slug);

    const result = await provisionClientWorkspaceForRequest(operatorHeaders, {
      companyName: "Invalid Input HVAC",
      organizationSlug: slug,
      ownerName: "Client Owner",
      ownerEmail,
      initialPassword: "short",
    });

    expect(result).toMatchObject({ status: "invalid_input", field: "password" });
    expect(await findUserByEmail(ownerEmail)).toBeNull();
    expect(await findOrganizationBySlug(slug)).toBeNull();
  });
});

describe("unauthorized provisioning attempts", () => {
  it("rejects a signed-in non-operator before validation or creation", async () => {
    const nonOperator = await createTestAccount({
      password: "non-operator-password-1",
      name: "Regular Client",
    });
    createdEmails.push(nonOperator.email);
    const nonOperatorHeaders = await signInHeaders(
      nonOperator.email,
      nonOperator.password,
    );

    const candidateEmail = uniqueTestEmail("client-owner");
    const candidateSlug = `it-unauthorized-${randomUUID().slice(0, 8)}`;
    createdEmails.push(candidateEmail);
    createdOrganizationSlugs.push(candidateSlug);

    // Valid input from a non-operator: rejected, no side effects.
    const validAttempt = await provisionClientWorkspaceForRequest(
      nonOperatorHeaders,
      {
        companyName: "Unauthorized Attempt",
        organizationSlug: candidateSlug,
        ownerName: "Intruder",
        ownerEmail: candidateEmail,
        initialPassword: "not-really-a-password-1",
      },
    );
    expect(validAttempt).toEqual({ status: "rejected" });

    // Invalid input from a non-operator is still rejected as unauthorized
    // (authorization is evaluated before validation).
    const invalidAttempt = await provisionClientWorkspaceForRequest(
      nonOperatorHeaders,
      {
        companyName: "",
        organizationSlug: candidateSlug,
        ownerName: "",
        ownerEmail: "not-an-email",
        initialPassword: "short",
      },
    );
    expect(invalidAttempt).toEqual({ status: "rejected" });

    expect(await findUserByEmail(candidateEmail)).toBeNull();
    expect(await findOrganizationBySlug(candidateSlug)).toBeNull();
    const memberships = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, nonOperator.id));
    expect(memberships).toHaveLength(0);
  });

  it("rejects an unauthenticated caller without side effects", async () => {
    const candidateEmail = uniqueTestEmail("client-owner");
    const candidateSlug = `it-unauthenticated-${randomUUID().slice(0, 8)}`;
    createdEmails.push(candidateEmail);
    createdOrganizationSlugs.push(candidateSlug);

    const result = await provisionClientWorkspaceForRequest(new Headers(), {
      companyName: "Anonymous Attempt",
      organizationSlug: candidateSlug,
      ownerName: "Anonymous",
      ownerEmail: candidateEmail,
      initialPassword: "anonymous-attempt-password-1",
    });

    expect(result).toEqual({ status: "rejected" });
    expect(await findUserByEmail(candidateEmail)).toBeNull();
    expect(await findOrganizationBySlug(candidateSlug)).toBeNull();
  });
});
