import { describe, expect, it } from "vitest";

import {
  isOperatorUserId,
  parseOperatorAllowlist,
} from "../../src/lib/operator-allowlist";

describe("parseOperatorAllowlist", () => {
  it("treats missing configuration as a denial (fail closed)", () => {
    expect(parseOperatorAllowlist(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(parseOperatorAllowlist("")).toEqual({ ok: false, reason: "missing" });
    expect(parseOperatorAllowlist("   ")).toEqual({ ok: false, reason: "missing" });
    expect(parseOperatorAllowlist(",")).toEqual({ ok: false, reason: "missing" });
  });

  it("parses a comma-separated list, trimming whitespace and dropping empties", () => {
    const parsed = parseOperatorAllowlist(" operator-1 , operator-2 ,, ");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect([...parsed.ids]).toEqual(["operator-1", "operator-2"]);
    }
  });

  it("rejects entries that are not single tokens", () => {
    const parsed = parseOperatorAllowlist("operator-1,not a token");
    expect(parsed).toEqual({
      ok: false,
      reason: "invalid",
      detail: expect.stringContaining("single user-ID token"),
    });
  });

  it("rejects unreasonably long entries", () => {
    const parsed = parseOperatorAllowlist("x".repeat(257));
    expect(parsed.ok).toBe(false);
  });
});

describe("isOperatorUserId", () => {
  it("matches only exact, case-sensitive user IDs", () => {
    expect(isOperatorUserId("operator-1", "operator-1,operator-2")).toBe(true);
    expect(isOperatorUserId("operator-3", "operator-1,operator-2")).toBe(false);
    expect(isOperatorUserId("OPERATOR-1", "operator-1")).toBe(false);
  });

  it("denies when the allowlist is missing, empty, or invalid", () => {
    expect(isOperatorUserId("operator-1", undefined)).toBe(false);
    expect(isOperatorUserId("operator-1", "")).toBe(false);
    expect(isOperatorUserId("operator-1", "operator-1 operator-2")).toBe(false);
  });

  it("denies when no verified user ID is present", () => {
    expect(isOperatorUserId(undefined, "operator-1")).toBe(false);
    expect(isOperatorUserId(null, "operator-1")).toBe(false);
    expect(isOperatorUserId("", "operator-1")).toBe(false);
  });
});
