import { afterAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";

import { db } from "../../src/db";
import { user } from "../../src/db/auth-schema";
import { auth } from "../../src/lib/auth";
import {
  INITIAL_PASSWORD_MAX_LENGTH,
  INITIAL_PASSWORD_MIN_LENGTH,
} from "../../src/lib/password-policy";
import {
  createTestAccount,
  deleteTestAccounts,
  describeError,
  findUserByEmail,
  postToAuthApi,
  uniqueTestEmail,
} from "../helpers/auth-test-helpers";

/**
 * Account-creation password-policy regression tests (Batch 4G / H-1).
 *
 * Better Auth's `admin/create-user` route enforces only the *maximum*
 * password length. The application's initial-password policy is 8-128
 * characters, enforced at the provisioning boundaries and - through
 * `initial-password-guard.ts` - at the Better Auth route itself, so no
 * HTTP-accessible account-creation path can create an out-of-policy
 * credential.
 *
 * Ordering note: the guard runs in `hooks.before`, before the route's own
 * authentication and authorization middleware. A short password therefore
 * produces 400 regardless of the caller's session or role; a
 * policy-compliant password still produces the original 401/403. This is
 * deliberate (it avoids validating a password only after an authorization
 * decision) and is covered below.
 */

const createdEmails: string[] = [];

afterAll(async () => {
  await deleteTestAccounts(createdEmails);
});

function tooShortPassword(): string {
  return "a".repeat(INITIAL_PASSWORD_MIN_LENGTH - 1);
}

function minimumPassword(): string {
  return "b".repeat(INITIAL_PASSWORD_MIN_LENGTH);
}

async function userExists(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.email, [email.toLowerCase()]))
    .limit(1);
  return rows.length > 0;
}

describe("admin/create-user enforces the 8-128 initial-password policy", () => {
  it("rejects an unauthenticated request with a short password before authentication, creating no account", async () => {
    const email = uniqueTestEmail("policy-unauth-short");
    createdEmails.push(email);

    const response = await postToAuthApi("/admin/create-user", {
      email,
      name: "Short Password",
      password: tooShortPassword(),
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    expect(response.cookieHeader).toBeNull();
    await expect(userExists(email)).resolves.toBe(false);
  });

  it("still returns 401 (not an account) for an unauthenticated policy-compliant request", async () => {
    const email = uniqueTestEmail("policy-unauth-valid");
    createdEmails.push(email);

    const response = await postToAuthApi("/admin/create-user", {
      email,
      name: "Valid Password",
      password: "policy-valid-password-1",
    });

    expect(response.status).toBe(401);
    expect(response.cookieHeader).toBeNull();
    await expect(userExists(email)).resolves.toBe(false);
  });

  it("rejects a signed-in non-admin with a short password and creates no account", async () => {
    const caller = await createTestAccount({
      password: "policy-non-admin-caller-1",
      name: "Policy Non Admin",
    });
    createdEmails.push(caller.email);

    const signIn = await postToAuthApi("/sign-in/email", {
      email: caller.email,
      password: caller.password,
    });
    expect(signIn.cookieHeader).not.toBeNull();

    const targetEmail = uniqueTestEmail("policy-non-admin-target");
    createdEmails.push(targetEmail);

    const response = await postToAuthApi(
      "/admin/create-user",
      {
        email: targetEmail,
        name: "Non Admin Target",
        password: tooShortPassword(),
      },
      signIn.cookieHeader,
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    await expect(userExists(targetEmail)).resolves.toBe(false);
  });

  it("still denies a signed-in non-admin with a compliant password (403) and creates no account", async () => {
    const caller = await createTestAccount({
      password: "policy-non-admin-caller-2",
      name: "Policy Non Admin 2",
    });
    createdEmails.push(caller.email);

    const signIn = await postToAuthApi("/sign-in/email", {
      email: caller.email,
      password: caller.password,
    });
    expect(signIn.cookieHeader).not.toBeNull();

    const targetEmail = uniqueTestEmail("policy-non-admin-target-2");
    createdEmails.push(targetEmail);

    const response = await postToAuthApi(
      "/admin/create-user",
      {
        email: targetEmail,
        name: "Non Admin Target 2",
        password: "policy-compliant-password-1",
      },
      signIn.cookieHeader,
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).not.toBe(400);
    await expect(userExists(targetEmail)).resolves.toBe(false);
  });

  it("rejects a short password on the server-side auth.api.createUser path", async () => {
    const email = uniqueTestEmail("policy-api-short");
    createdEmails.push(email);

    let caught: unknown;
    try {
      await auth.api.createUser({
        body: { email, name: "API Short", password: tooShortPassword() },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(describeError(caught)).toMatch(/PASSWORD_TOO_SHORT|too short/i);
    await expect(userExists(email)).resolves.toBe(false);
  });

  it("rejects an empty password instead of creating a credential-less account", async () => {
    const email = uniqueTestEmail("policy-api-empty");
    createdEmails.push(email);

    let caught: unknown;
    try {
      await auth.api.createUser({
        body: { email, name: "API Empty", password: "" },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(describeError(caught)).toMatch(/PASSWORD_TOO_SHORT|too short/i);
    await expect(userExists(email)).resolves.toBe(false);
  });

  it("rejects a password over the maximum length on the server-side path", async () => {
    const email = uniqueTestEmail("policy-api-long");
    createdEmails.push(email);

    let caught: unknown;
    try {
      await auth.api.createUser({
        body: {
          email,
          name: "API Long",
          password: "a".repeat(INITIAL_PASSWORD_MAX_LENGTH + 1),
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(describeError(caught)).toMatch(/PASSWORD_TOO_LONG|too long/i);
    await expect(userExists(email)).resolves.toBe(false);
  });

  it("accepts the 8-character boundary, keeps the default user role, and preserves sign-in", async () => {
    const email = uniqueTestEmail("policy-api-minimum");
    const password = minimumPassword();

    const created = await auth.api.createUser({
      body: { email, name: "Minimum Password", password },
    });
    createdEmails.push(email);

    expect(created.user.id).toBeTruthy();
    expect((created.user as { role?: string | null }).role).toBe("user");

    const stored = await findUserByEmail(email);
    expect(stored?.role).toBe("user");

    // The initial password still works for the normal client sign-in flow.
    const signIn = await postToAuthApi("/sign-in/email", { email, password });
    expect(signIn.status).toBe(200);
    expect(signIn.cookieHeader).not.toBeNull();
  });
});
