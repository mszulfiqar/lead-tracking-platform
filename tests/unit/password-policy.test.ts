import { describe, expect, it } from "vitest";

import {
  INITIAL_PASSWORD_MAX_LENGTH,
  INITIAL_PASSWORD_MIN_LENGTH,
  validateInitialPassword,
} from "../../src/lib/password-policy";

describe("initial password policy", () => {
  it("requires 8 to 128 characters", () => {
    expect(INITIAL_PASSWORD_MIN_LENGTH).toBe(8);
    expect(INITIAL_PASSWORD_MAX_LENGTH).toBe(128);
  });

  it("rejects passwords shorter than the minimum", () => {
    expect(validateInitialPassword("")).toEqual({ ok: false, reason: "too_short" });
    expect(validateInitialPassword("1234567")).toEqual({
      ok: false,
      reason: "too_short",
    });
  });

  it("accepts boundary lengths", () => {
    expect(validateInitialPassword("12345678")).toEqual({ ok: true });
    expect(validateInitialPassword("a".repeat(128))).toEqual({ ok: true });
  });

  it("rejects passwords longer than the maximum", () => {
    expect(validateInitialPassword("a".repeat(129))).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("rejects non-string values", () => {
    expect(validateInitialPassword(undefined)).toEqual({
      ok: false,
      reason: "not_a_string",
    });
    expect(validateInitialPassword(12345678)).toEqual({
      ok: false,
      reason: "not_a_string",
    });
  });
});
