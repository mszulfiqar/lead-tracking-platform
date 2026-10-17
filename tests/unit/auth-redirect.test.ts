import { describe, expect, it } from "vitest";

import {
  postAuthDestination,
  sanitizeReturnTo,
} from "../../src/lib/auth-redirect";
import type { OperatorAccess } from "../../src/lib/operator-access";

describe("sanitizeReturnTo", () => {
  it("accepts same-origin application paths", () => {
    expect(sanitizeReturnTo("/operator")).toBe("/operator");
    expect(sanitizeReturnTo("/operator/leads?status=new&page=2")).toBe(
      "/operator/leads?status=new&page=2",
    );
    expect(sanitizeReturnTo("  /no-access  ")).toBe("/no-access");
  });

  it("rejects external redirect targets", () => {
    expect(sanitizeReturnTo("https://evil.example.com")).toBeNull();
    expect(sanitizeReturnTo("http://evil.example.com/operator")).toBeNull();
    expect(sanitizeReturnTo("//evil.example.com")).toBeNull();
    expect(sanitizeReturnTo("///evil.example.com")).toBeNull();
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeNull();
    expect(sanitizeReturnTo("/\\evil.example.com")).toBeNull();
    expect(sanitizeReturnTo("/operator\\..\\..\\evil")).toBeNull();
  });

  it("rejects missing, empty, malformed, or oversized values", () => {
    expect(sanitizeReturnTo(null)).toBeNull();
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo("")).toBeNull();
    expect(sanitizeReturnTo("   ")).toBeNull();
    expect(sanitizeReturnTo("operator")).toBeNull();
    expect(sanitizeReturnTo("/has space")).toBeNull();
    expect(sanitizeReturnTo("/line\nbreak")).toBeNull();
    expect(sanitizeReturnTo(`/${"a".repeat(513)}`)).toBeNull();
  });
});

describe("postAuthDestination", () => {
  const user = { id: "user-1", email: "user@example.test", name: "User" };

  it("routes verified operators to the operator experience", () => {
    const access: OperatorAccess = { status: "operator", user };
    expect(postAuthDestination(access, false)).toBe("/operator");
  });

  it("never demotes an operator with a workspace membership to the client workspace", () => {
    const access: OperatorAccess = { status: "operator", user };
    expect(postAuthDestination(access, true)).toBe("/operator");
  });

  it("routes verified workspace members to the client workspace", () => {
    const access: OperatorAccess = {
      status: "denied",
      user,
      allowlistProblem: null,
    };
    expect(postAuthDestination(access, true)).toBe("/workspace");
  });

  it("routes authenticated users without verified access to the denial page", () => {
    const access: OperatorAccess = {
      status: "denied",
      user,
      allowlistProblem: null,
    };
    expect(postAuthDestination(access, false)).toBe("/no-access");
  });

  it("a degraded operator allowlist never sends a member to the operator console", () => {
    const access: OperatorAccess = {
      status: "denied",
      user,
      allowlistProblem: "missing",
    };
    expect(postAuthDestination(access, true)).toBe("/workspace");
    expect(postAuthDestination(access, false)).toBe("/no-access");
  });

  it("routes unauthenticated users to the shared sign-in page", () => {
    const access: OperatorAccess = { status: "unauthenticated" };
    expect(postAuthDestination(access, false)).toBe("/sign-in");
    expect(postAuthDestination(access, true)).toBe("/sign-in");
  });
});
