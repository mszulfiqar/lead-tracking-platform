import { describe, expect, it, vi } from "vitest";

import type { GuardedDatabaseTarget } from "../../src/lib/database-safety";
import { DatabaseSafetyError } from "../../src/lib/database-safety";
import {
  bootstrapOperator,
  BootstrapInputError,
  normalizeOperatorEmail,
  type BootstrapOperatorDeps,
} from "../../src/lib/operator-bootstrap";

const target: GuardedDatabaseTarget = {
  url: new URL("postgresql://dev:pass@localhost:5432/lead_tracking_platform"),
  host: "localhost",
  port: "5432",
  database: "lead_tracking_platform",
  summary: "localhost:5432/lead_tracking_platform",
};

const VALID_PASSWORD = "operator-password-1";

function createDeps(
  overrides: Partial<BootstrapOperatorDeps> = {},
): BootstrapOperatorDeps {
  return {
    target,
    prompts: {
      email: vi.fn(async () => "Operator@Example.test"),
      name: vi.fn(async () => "Platform Owner"),
      password: vi.fn(async () => VALID_PASSWORD),
      confirmPassword: vi.fn(async () => VALID_PASSWORD),
    },
    verifyDatabaseIdentity: vi.fn(async () => ({
      databaseName: "lead_tracking_platform",
      serverVersion: "PostgreSQL 17.4",
    })),
    findUserIdByEmail: vi.fn(async () => null),
    createUser: vi.fn(async () => ({ id: "generated-user-id" })),
    log: vi.fn(),
    ...overrides,
  };
}

describe("bootstrapOperator", () => {
  it("verifies the database identity before creating the account", async () => {
    const order: string[] = [];
    const deps = createDeps({
      verifyDatabaseIdentity: vi.fn(async () => {
        order.push("verify");
        return { databaseName: "lead_tracking_platform", serverVersion: "PostgreSQL 17.4" };
      }),
      createUser: vi.fn(async () => {
        order.push("create");
        return { id: "generated-user-id" };
      }),
    });

    const result = await bootstrapOperator(deps);

    expect(order).toEqual(["verify", "create"]);
    expect(result).toEqual({
      status: "created",
      userId: "generated-user-id",
      email: "operator@example.test",
    });
  });

  it("creates the account with email, name, and password only (no role)", async () => {
    const deps = createDeps();
    await bootstrapOperator(deps);

    expect(deps.createUser).toHaveBeenCalledTimes(1);
    const call = vi.mocked(deps.createUser).mock.calls[0]?.[0];
    expect(Object.keys(call ?? {})).toEqual(["email", "name", "password"]);
    expect(call?.email).toBe("operator@example.test");
    expect(call?.name).toBe("Platform Owner");
    expect(call?.password).toBe(VALID_PASSWORD);
  });

  it("never logs the password or a secret value", async () => {
    const deps = createDeps();
    await bootstrapOperator(deps);

    const logged = vi
      .mocked(deps.log)
      .mock.calls.map((call) => call[0])
      .join("\n");
    expect(logged).not.toContain(VALID_PASSWORD);
  });

  it("fails safely when the account already exists without changing it", async () => {
    const deps = createDeps({
      findUserIdByEmail: vi.fn(async () => "existing-user-id"),
    });

    const result = await bootstrapOperator(deps);

    expect(result).toEqual({
      status: "existing",
      userId: "existing-user-id",
      email: "operator@example.test",
    });
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it("refuses mismatched password confirmation", async () => {
    const deps = createDeps({
      prompts: {
        ...createDeps().prompts,
        confirmPassword: vi.fn(async () => "different-password-1"),
      },
    });

    await expect(bootstrapOperator(deps)).rejects.toThrow(BootstrapInputError);
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it("enforces the 8-128 character password policy before creating anything", async () => {
    const short = createDeps({
      prompts: {
        ...createDeps().prompts,
        password: vi.fn(async () => "short"),
        confirmPassword: vi.fn(async () => "short"),
      },
    });
    await expect(bootstrapOperator(short)).rejects.toThrowError(/8 and 128/);
    expect(short.createUser).not.toHaveBeenCalled();

    const long = createDeps({
      prompts: {
        ...createDeps().prompts,
        password: vi.fn(async () => "a".repeat(129)),
        confirmPassword: vi.fn(async () => "a".repeat(129)),
      },
    });
    await expect(bootstrapOperator(long)).rejects.toThrowError(/8 and 128/);
    expect(long.createUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid email before creating anything", async () => {
    const deps = createDeps({
      prompts: { ...createDeps().prompts, email: vi.fn(async () => "not-an-email") },
    });
    await expect(bootstrapOperator(deps)).rejects.toThrow(BootstrapInputError);
    expect(deps.createUser).not.toHaveBeenCalled();
  });

  it("stops when the live database identity does not match the validated target", async () => {
    const deps = createDeps({
      verifyDatabaseIdentity: vi.fn(async () => ({
        databaseName: "some_other_database",
        serverVersion: "PostgreSQL 17.4",
      })),
    });

    await expect(bootstrapOperator(deps)).rejects.toThrow(DatabaseSafetyError);
    expect(deps.createUser).not.toHaveBeenCalled();
    expect(deps.prompts.email).not.toHaveBeenCalled();
  });

  it("defaults the display name when the operator leaves it empty", async () => {
    const deps = createDeps({
      prompts: { ...createDeps().prompts, name: vi.fn(async () => "   ") },
    });
    await bootstrapOperator(deps);
    const call = vi.mocked(deps.createUser).mock.calls[0]?.[0];
    expect(call?.name).toBe("Platform Operator");
  });
});

describe("normalizeOperatorEmail", () => {
  it("trims and lowercases operator emails", () => {
    expect(normalizeOperatorEmail("  Owner@Example.TEST ")).toBe("owner@example.test");
  });
});
