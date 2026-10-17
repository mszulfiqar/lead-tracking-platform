import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveOperatorAccess } from "../../src/lib/operator-access";
import {
  createTestAccount,
  deleteTestAccounts,
  postToAuthApi,
  type CreatedTestAccount,
} from "../helpers/auth-test-helpers";

let operator: CreatedTestAccount;
let otherUser: CreatedTestAccount;
let operatorCookie: string;

beforeAll(async () => {
  operator = await createTestAccount({
    password: "operator-account-password-1",
    name: "Operator Account",
  });
  otherUser = await createTestAccount({
    password: "other-account-password-1",
    name: "Non Operator",
  });

  const signIn = await postToAuthApi("/sign-in/email", {
    email: operator.email,
    password: operator.password,
  });
  if (!signIn.cookieHeader) {
    throw new Error("Test setup failed: operator could not sign in.");
  }
  operatorCookie = signIn.cookieHeader;
});

afterAll(async () => {
  await deleteTestAccounts([operator.email, otherUser.email]);
});

describe("resolveOperatorAccess", () => {
  it("authorizes an authenticated user whose verified ID is in the allowlist", async () => {
    const access = await resolveOperatorAccess(
      new Headers({ cookie: operatorCookie }),
      operator.id,
    );
    expect(access.status).toBe("operator");
    if (access.status === "operator") {
      expect(access.user.id).toBe(operator.id);
      expect(access.user.email).toBe(operator.email);
    }
  });

  it("authorizes an allowlisted user even without organization membership", async () => {
    // The organization plugin is enabled, but these test accounts hold no
    // organization membership; operator access must not depend on it.
    const access = await resolveOperatorAccess(
      new Headers({ cookie: operatorCookie }),
      `${otherUser.id}, ${operator.id}`,
    );
    expect(access.status).toBe("operator");
  });

  it("denies an authenticated user who is not allowlisted", async () => {
    const access = await resolveOperatorAccess(
      new Headers({ cookie: operatorCookie }),
      otherUser.id,
    );
    expect(access.status).toBe("denied");
    if (access.status === "denied") {
      expect(access.user.id).toBe(operator.id);
      expect(access.allowlistProblem).toBeNull();
    }
  });

  it("fails closed when the allowlist is missing or invalid", async () => {
    const missing = await resolveOperatorAccess(
      new Headers({ cookie: operatorCookie }),
      undefined,
    );
    expect(missing).toMatchObject({ status: "denied", allowlistProblem: "missing" });

    const invalid = await resolveOperatorAccess(
      new Headers({ cookie: operatorCookie }),
      "not a token with spaces",
    );
    expect(invalid).toMatchObject({ status: "denied", allowlistProblem: "invalid" });
  });

  it("ignores client-supplied privilege claims in headers", async () => {
    const access = await resolveOperatorAccess(
      new Headers({
        cookie: operatorCookie,
        "x-operator": "true",
        "x-user-id": operator.id,
        "x-user-role": "admin",
      }),
      otherUser.id,
    );
    expect(access.status).toBe("denied");
  });

  it("returns unauthenticated when there is no valid session", async () => {
    const noCookie = await resolveOperatorAccess(new Headers(), operator.id);
    expect(noCookie.status).toBe("unauthenticated");

    const forged = await resolveOperatorAccess(
      new Headers({ cookie: "better-auth.session_token=forged", "x-operator": "true" }),
      operator.id,
    );
    expect(forged.status).toBe("unauthenticated");
  });
});
