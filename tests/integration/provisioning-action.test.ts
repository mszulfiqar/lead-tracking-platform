import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { member, organization } from "../../src/db/auth-schema";
import { executeProvisionClientRequest } from "../../src/lib/provisioning-action";
import {
  createTestAccount,
  deleteTestAccounts,
  findUserByEmail,
  postToAuthApi,
  uniqueTestEmail,
  type CreatedTestAccount,
} from "../helpers/auth-test-helpers";

/**
 * Integration tests for the operator console create-client action
 * (`executeProvisionClientRequest`, wired to the `"use server"` entry point in
 * `src/app/operator/actions.ts`) against the real provisioning service, real
 * Better Auth APIs, and the dedicated test database.
 *
 * This exercises the full form-submission path: submitted FormData is parsed,
 * the confirmation field is enforced, the provisioning service re-verifies
 * the platform-operator allowlist from the request headers, and the result is
 * mapped onto the exact state the operator UI displays.
 */

const createdEmails: string[] = [];
const createdOrganizationSlugs: string[] = [];
const originalOperatorAllowlist = process.env.PLATFORM_OPERATOR_USER_IDS;

let operator: CreatedTestAccount;
let operatorHeaders: Headers;

function formDataFor(values: {
  companyName: string;
  organizationSlug?: string;
  ownerName: string;
  ownerEmail: string;
  initialPassword: string;
  confirmPassword?: string;
}): FormData {
  const formData = new FormData();
  formData.set("companyName", values.companyName);
  formData.set("organizationSlug", values.organizationSlug ?? "");
  formData.set("ownerName", values.ownerName);
  formData.set("ownerEmail", values.ownerEmail);
  formData.set("initialPassword", values.initialPassword);
  formData.set(
    "confirmPassword",
    values.confirmPassword ?? values.initialPassword,
  );
  return formData;
}

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

beforeAll(async () => {
  operator = await createTestAccount({
    password: "operator-console-password-1",
    name: "Console Operator",
  });
  createdEmails.push(operator.email);

  const signIn = await postToAuthApi("/sign-in/email", {
    email: operator.email,
    password: operator.password,
  });
  if (!signIn.cookieHeader) {
    throw new Error("Test setup failed: operator could not sign in.");
  }
  operatorHeaders = new Headers({ cookie: signIn.cookieHeader });
  process.env.PLATFORM_OPERATOR_USER_IDS = operator.id;
});

afterAll(async () => {
  if (originalOperatorAllowlist === undefined) {
    delete process.env.PLATFORM_OPERATOR_USER_IDS;
  } else {
    process.env.PLATFORM_OPERATOR_USER_IDS = originalOperatorAllowlist;
  }
  if (createdOrganizationSlugs.length > 0) {
    await db
      .delete(organization)
      .where(inArray(organization.slug, createdOrganizationSlugs));
  }
  await deleteTestAccounts(createdEmails);
});

describe("operator console create-client action", () => {
  it("provisions a client workspace from submitted form data", async () => {
    const suffix = randomUUID().slice(0, 8);
    const ownerEmail = uniqueTestEmail("console-owner");
    const slug = `console-client-${suffix}`;
    const ownerPassword = "console-initial-password-1";
    createdEmails.push(ownerEmail);
    createdOrganizationSlugs.push(slug);

    const state = await executeProvisionClientRequest(
      operatorHeaders,
      formDataFor({
        companyName: `Console Client ${suffix}`,
        organizationSlug: slug,
        ownerName: "Console Owner",
        ownerEmail: ownerEmail.toUpperCase(),
        initialPassword: ownerPassword,
      }),
    );

    // Exact displayed state: verified facts only, no internal IDs and no
    // password material of any kind.
    expect(state).toEqual({
      status: "provisioned",
      organizationName: `Console Client ${suffix}`,
      organizationSlug: slug,
      ownerEmail,
    });
    expect(JSON.stringify(state)).not.toContain(ownerPassword);

    // The workspace really exists with the account as its verified owner.
    const storedOrganization = await findOrganizationBySlug(slug);
    expect(storedOrganization?.name).toBe(`Console Client ${suffix}`);
    const storedUser = await findUserByEmail(ownerEmail);
    expect(storedUser?.role).toBe("user");
    const membership = await db
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.organizationId, storedOrganization?.id ?? ""),
          eq(member.userId, storedUser?.id ?? ""),
        ),
      )
      .limit(1);
    expect(membership[0]?.role).toBe("owner");
  });

  it("generates the workspace link from the company name when the slug field is empty", async () => {
    const suffix = randomUUID().slice(0, 8);
    const ownerEmail = uniqueTestEmail("console-owner");
    const expectedSlug = `action-hvac-${suffix}`;
    createdEmails.push(ownerEmail);
    createdOrganizationSlugs.push(expectedSlug);

    const state = await executeProvisionClientRequest(
      operatorHeaders,
      formDataFor({
        companyName: `Action HVAC ${suffix}`,
        organizationSlug: "",
        ownerName: "Generated Slug Owner",
        ownerEmail,
        initialPassword: "generated-slug-password-1",
      }),
    );

    expect(state).toEqual({
      status: "provisioned",
      organizationName: `Action HVAC ${suffix}`,
      organizationSlug: expectedSlug,
      ownerEmail,
    });
    expect(await findOrganizationBySlug(expectedSlug)).not.toBeNull();
  });

  it("rejects a mismatched password confirmation before anything is created", async () => {
    const ownerEmail = uniqueTestEmail("console-owner");
    const slug = `console-mismatch-${randomUUID().slice(0, 8)}`;
    createdEmails.push(ownerEmail);
    createdOrganizationSlugs.push(slug);

    const state = await executeProvisionClientRequest(
      operatorHeaders,
      formDataFor({
        companyName: "Mismatch HVAC",
        organizationSlug: slug,
        ownerName: "Mismatch Owner",
        ownerEmail,
        initialPassword: "mismatch-password-1",
        confirmPassword: "a-different-password-1",
      }),
    );

    expect(state).toMatchObject({
      status: "invalid_input",
      field: "confirmPassword",
    });
    // The message never echoes either password value.
    if (state.status === "invalid_input") {
      expect(state.message).not.toContain("mismatch-password-1");
      expect(state.message).not.toContain("a-different-password-1");
    }
    expect(await findUserByEmail(ownerEmail)).toBeNull();
    expect(await findOrganizationBySlug(slug)).toBeNull();
  });

  it("reports invalid input with the affected form field and creates nothing", async () => {
    const ownerEmail = uniqueTestEmail("console-owner");
    const slug = `console-invalid-${randomUUID().slice(0, 8)}`;
    createdEmails.push(ownerEmail);
    createdOrganizationSlugs.push(slug);

    const state = await executeProvisionClientRequest(
      operatorHeaders,
      formDataFor({
        companyName: "Invalid HVAC",
        organizationSlug: slug,
        ownerName: "Invalid Owner",
        ownerEmail,
        initialPassword: "short",
      }),
    );

    expect(state).toMatchObject({
      status: "invalid_input",
      field: "initialPassword",
    });
    expect(await findUserByEmail(ownerEmail)).toBeNull();
    expect(await findOrganizationBySlug(slug)).toBeNull();
  });

  it("reports a duplicate email conflict on the email field and creates nothing", async () => {
    const existing = await createTestAccount({
      password: "existing-console-password-1",
      name: "Existing Console Owner",
    });
    createdEmails.push(existing.email);
    const slug = `console-duplicate-${randomUUID().slice(0, 8)}`;
    createdOrganizationSlugs.push(slug);

    const state = await executeProvisionClientRequest(
      operatorHeaders,
      formDataFor({
        companyName: "Duplicate Console HVAC",
        organizationSlug: slug,
        ownerName: "Duplicate Owner",
        ownerEmail: existing.email.toUpperCase(),
        initialPassword: "duplicate-console-password-1",
      }),
    );

    expect(state).toMatchObject({ status: "conflict", field: "ownerEmail" });
    expect(await findOrganizationBySlug(slug)).toBeNull();
  });

  it("rejects a signed-in non-operator even with a valid form and creates nothing", async () => {
    const nonOperator = await createTestAccount({
      password: "console-non-operator-password-1",
      name: "Console Non Operator",
    });
    createdEmails.push(nonOperator.email);
    const signIn = await postToAuthApi("/sign-in/email", {
      email: nonOperator.email,
      password: nonOperator.password,
    });
    if (!signIn.cookieHeader) {
      throw new Error("Test setup failed: non-operator could not sign in.");
    }
    const nonOperatorHeaders = new Headers({ cookie: signIn.cookieHeader });

    const ownerEmail = uniqueTestEmail("console-owner");
    const slug = `console-unauthorized-${randomUUID().slice(0, 8)}`;
    createdEmails.push(ownerEmail);
    createdOrganizationSlugs.push(slug);

    const state = await executeProvisionClientRequest(
      nonOperatorHeaders,
      formDataFor({
        companyName: "Unauthorized Console HVAC",
        organizationSlug: slug,
        ownerName: "Unauthorized Owner",
        ownerEmail,
        initialPassword: "unauthorized-console-password-1",
      }),
    );

    expect(state).toEqual({ status: "rejected" });
    expect(await findUserByEmail(ownerEmail)).toBeNull();
    expect(await findOrganizationBySlug(slug)).toBeNull();
    // The caller gained no membership through the attempt.
    const memberships = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, nonOperator.id));
    expect(memberships).toHaveLength(0);
  });

  it("rejects an unauthenticated form submission and creates nothing", async () => {
    const ownerEmail = uniqueTestEmail("console-owner");
    const slug = `console-anonymous-${randomUUID().slice(0, 8)}`;
    createdEmails.push(ownerEmail);
    createdOrganizationSlugs.push(slug);

    const state = await executeProvisionClientRequest(
      new Headers(),
      formDataFor({
        companyName: "Anonymous Console HVAC",
        organizationSlug: slug,
        ownerName: "Anonymous Owner",
        ownerEmail,
        initialPassword: "anonymous-console-password-1",
      }),
    );

    expect(state).toEqual({ status: "rejected" });
    expect(await findUserByEmail(ownerEmail)).toBeNull();
    expect(await findOrganizationBySlug(slug)).toBeNull();
  });
});
