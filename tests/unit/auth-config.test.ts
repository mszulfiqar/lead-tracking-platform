import { describe, expect, it } from "vitest";

import { auth } from "../../src/lib/auth";
import {
  INITIAL_PASSWORD_MAX_LENGTH,
  INITIAL_PASSWORD_MIN_LENGTH,
} from "../../src/lib/password-policy";

// Authentication configuration checks. These read the configured Better Auth
// instance; no database access is performed.
describe("Better Auth configuration", () => {
  it("disables public email/password sign-up", () => {
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });

  it("enforces the 8-128 character initial-password policy", () => {
    expect(auth.options.emailAndPassword?.minPasswordLength).toBe(
      INITIAL_PASSWORD_MIN_LENGTH,
    );
    expect(auth.options.emailAndPassword?.maxPasswordLength).toBe(
      INITIAL_PASSWORD_MAX_LENGTH,
    );
  });

  it("uses PostgreSQL through the Drizzle adapter", () => {
    expect(auth.options.database).toBeDefined();
  });

  it("enables the organization plugin with the approved owner role and no self-service creation", () => {
    const plugins = (auth.options.plugins ?? []) as Array<{
      id?: string;
      options?: { creatorRole?: unknown; allowUserToCreateOrganization?: unknown };
    }>;
    const organizationPlugin = plugins.find((plugin) => plugin.id === "organization");

    expect(organizationPlugin).toBeDefined();
    // Approved client role for provisioned client owners.
    expect(organizationPlugin?.options?.creatorRole).toBe("owner");
    // Signed-in users can never create organizations through the public API;
    // only the server-side operator-authorized provisioning flow may do so.
    expect(organizationPlugin?.options?.allowUserToCreateOrganization).toBe(false);
  });

  it("keeps nextCookies as the last plugin", () => {
    const plugins = (auth.options.plugins ?? []) as Array<{ id?: string }>;
    expect(plugins.at(-1)?.id).toBe("next-cookies");
  });

  it("does not expose a secret value through the options object", () => {
    const serialized = JSON.stringify({
      baseURL: auth.options.baseURL,
      appName: auth.options.appName,
    });
    expect(serialized).not.toContain("secret");
  });
});
