import { afterAll, describe, expect, it } from "vitest";

import { auth } from "../../src/lib/auth";
import {
  createTestAccount,
  deleteTestAccounts,
  describeError,
  findUserByEmail,
  getSessionForCookie,
  postToAuthApi,
  uniqueTestEmail,
} from "../helpers/auth-test-helpers";

const createdEmails: string[] = [];

afterAll(async () => {
  await deleteTestAccounts(createdEmails);
});

describe("public registration is disabled", () => {
  it("rejects the public sign-up endpoint and creates no account", async () => {
    const email = uniqueTestEmail("signup-attempt");
    const response = await postToAuthApi("/sign-up/email", {
      email,
      password: "public-signup-password-1",
      name: "Blocked Signup",
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).toContain("EMAIL_PASSWORD_SIGN_UP_DISABLED");
    expect(response.cookieHeader).toBeNull();
    await expect(findUserByEmail(email)).resolves.toBeNull();
  });
});

describe("sign-in with email and password", () => {
  it("rejects invalid credentials without creating a session", async () => {
    const account = await createTestAccount({
      password: "correct-password-1",
      name: "Invalid Credentials",
    });
    createdEmails.push(account.email);

    const response = await postToAuthApi("/sign-in/email", {
      email: account.email,
      password: "wrong-password-1",
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.cookieHeader).toBeNull();
  });

  it("establishes a server-verifiable session with valid credentials", async () => {
    const account = await createTestAccount({
      password: "correct-password-1",
      name: "Valid Credentials",
    });
    createdEmails.push(account.email);

    const response = await postToAuthApi("/sign-in/email", {
      email: account.email,
      password: account.password,
    });

    expect(response.status).toBe(200);
    expect(response.cookieHeader).not.toBeNull();

    const session = await getSessionForCookie(response.cookieHeader ?? "");
    expect(session?.user.id).toBe(account.id);
    expect(session?.user.email).toBe(account.email);
  });

  it("does not verify missing or forged session cookies", async () => {
    await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
    await expect(
      auth.api.getSession({
        headers: new Headers({ cookie: "better-auth.session_token=forged-session-token" }),
      }),
    ).resolves.toBeNull();
  });
});

describe("server-side account provisioning", () => {
  it("creates an account with the default client role", async () => {
    const account = await createTestAccount({
      password: "provisioned-password-1",
      name: "Provisioned User",
    });
    createdEmails.push(account.email);

    expect(account.role).toBe("user");
    const stored = await findUserByEmail(account.email);
    expect(stored?.role).toBe("user");
    expect(stored?.role).not.toBe("admin");
  });

  // Better Auth's admin-plugin `createUser` applies `assertPasswordNotTooLong`
  // but not `emailAndPassword.minPasswordLength`; the shared 8-128 policy is
  // enforced at the application provisioning boundary and, since Batch 4G, by
  // the `initial-password-guard.ts` before-hook on `/admin/create-user` itself
  // (see `tests/integration/account-creation-policy.test.ts`).
  it("rejects passwords longer than 128 characters", async () => {
    const email = uniqueTestEmail("long-password");
    let caught: unknown;
    try {
      await auth.api.createUser({
        body: { email, name: "Too Long", password: "a".repeat(129) },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(describeError(caught)).toMatch(/PASSWORD_TOO_LONG|too long/i);
    await expect(findUserByEmail(email)).resolves.toBeNull();
  });
});

describe("admin API endpoint protection", () => {
  it("rejects unauthenticated user creation through the HTTP endpoint", async () => {
    const email = uniqueTestEmail("http-provisioning");
    const response = await postToAuthApi("/admin/create-user", {
      email,
      name: "Unauthorized Caller",
      password: "unauthorized-password-1",
    });

    expect(response.status).toBe(401);
    // Better Auth answers this protected endpoint with an empty 401 body; the
    // assertions below matter most: no session cookie and no account created.
    expect(response.cookieHeader).toBeNull();
    await expect(findUserByEmail(email)).resolves.toBeNull();
  });

  it("rejects non-admin users trying to create accounts through the HTTP endpoint", async () => {
    const caller = await createTestAccount({
      password: "non-admin-caller-1",
      name: "Non Admin Caller",
    });
    createdEmails.push(caller.email);

    const signIn = await postToAuthApi("/sign-in/email", {
      email: caller.email,
      password: caller.password,
    });
    expect(signIn.cookieHeader).not.toBeNull();

    const targetEmail = uniqueTestEmail("non-admin-target");
    const response = await auth.handler(
      new Request(`${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/auth/admin/create-user`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: signIn.cookieHeader ?? "",
        },
        body: JSON.stringify({
          email: targetEmail,
          name: "Privilege Escalation Attempt",
          password: "escalation-password-1",
        }),
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    await expect(findUserByEmail(targetEmail)).resolves.toBeNull();
  });
});
