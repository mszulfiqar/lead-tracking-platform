/**
 * Unit tests for the initial-password guard (Batch 4G / H-1 remediation).
 *
 * Better Auth's `admin/create-user` route only enforces the maximum password
 * length; the guard applies the shared 8-128 initial-password policy to that
 * route through `hooks.before`, for HTTP callers and `auth.api.*` callers
 * alike. The codes and messages mirror Better Auth's own
 * `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG` errors.
 */
import { describe, expect, it } from "vitest";

import { checkInitialPasswordPayload } from "../../src/lib/initial-password-guard";

const CREATE_USER = "/admin/create-user";

describe("checkInitialPasswordPayload", () => {
  it("accepts the minimum allowed length (8 characters)", () => {
    expect(checkInitialPasswordPayload(CREATE_USER, { password: "12345678" })).toBeNull();
  });

  it("accepts the maximum allowed length (128 characters)", () => {
    expect(
      checkInitialPasswordPayload(CREATE_USER, { password: "a".repeat(128) }),
    ).toBeNull();
  });

  it("rejects passwords shorter than 8 characters with Better Auth's own error", () => {
    expect(
      checkInitialPasswordPayload(CREATE_USER, { password: "1234567" }),
    ).toEqual({ code: "PASSWORD_TOO_SHORT", message: "Password too short" });
  });

  it("rejects an empty password instead of creating a credential-less account", () => {
    // The plugin treats a falsy password as "no credential account"; for an
    // operator-managed provisioning flow that must be an explicit error.
    expect(checkInitialPasswordPayload(CREATE_USER, { password: "" })).toEqual({
      code: "PASSWORD_TOO_SHORT",
      message: "Password too short",
    });
  });

  it("rejects passwords longer than 128 characters with Better Auth's own error", () => {
    expect(
      checkInitialPasswordPayload(CREATE_USER, { password: "a".repeat(129) }),
    ).toEqual({ code: "PASSWORD_TOO_LONG", message: "Password too long" });
  });

  it("leaves omitted passwords to Better Auth (magic-link / social-only accounts)", () => {
    expect(checkInitialPasswordPayload(CREATE_USER, { email: "a@example.test" })).toBeNull();
  });

  it("leaves non-string passwords to Better Auth's schema validation", () => {
    expect(checkInitialPasswordPayload(CREATE_USER, { password: 12345678 })).toBeNull();
    expect(checkInitialPasswordPayload(CREATE_USER, { password: null })).toBeNull();
  });

  it("leaves non-object bodies to Better Auth", () => {
    expect(checkInitialPasswordPayload(CREATE_USER, undefined)).toBeNull();
    expect(checkInitialPasswordPayload(CREATE_USER, null)).toBeNull();
    expect(checkInitialPasswordPayload(CREATE_USER, "password")).toBeNull();
    expect(checkInitialPasswordPayload(CREATE_USER, [])).toBeNull();
  });

  it("ignores other routes, including set-user-password which Better Auth already validates", () => {
    expect(
      checkInitialPasswordPayload("/admin/set-user-password", { password: "short" }),
    ).toBeNull();
    expect(checkInitialPasswordPayload("/sign-in/email", { password: "short" })).toBeNull();
    expect(checkInitialPasswordPayload("/sign-up/email", { password: "short" })).toBeNull();
  });
});
