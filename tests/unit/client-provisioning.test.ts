import { describe, expect, it, vi } from "vitest";

import type { OperatorAccess } from "../../src/lib/operator-access";
import {
  generateOrganizationSlug,
  provisionClientWorkspace,
  type ClientProvisioningResult,
  type ProvisioningDeps,
  type ProvisioningField,
  type ProvisioningInput,
} from "../../src/lib/client-provisioning";

const VALID_PASSWORD = "client-initial-password-1";

const OPERATOR_ACCESS: OperatorAccess = {
  status: "operator",
  user: {
    id: "operator-user-1",
    email: "operator@example.test",
    name: "Platform Operator",
  },
};

const WORKSPACE = {
  id: "org-1",
  name: "Acme Heating & Air",
  slug: "acme-heating-air",
};

function validInput(overrides: Partial<ProvisioningInput> = {}): ProvisioningInput {
  return {
    companyName: "Acme Heating & Air",
    ownerName: "Alice Owner",
    ownerEmail: "Owner@Example.test",
    initialPassword: VALID_PASSWORD,
    ...overrides,
  };
}

function createDeps(overrides: Partial<ProvisioningDeps> = {}): ProvisioningDeps {
  return {
    resolveOperatorAccess: vi.fn(async () => OPERATOR_ACCESS),
    findUserIdByEmail: vi.fn(async () => null),
    findOrganizationBySlug: vi.fn(async () => null),
    createClientUser: vi.fn(async () => ({ id: "client-user-1" })),
    createOrganizationForOwner: vi.fn(async () => ({ id: "org-1" })),
    findMembership: vi.fn(async () => ({ role: "owner" })),
    deleteUser: vi.fn(async () => {}),
    log: vi.fn(),
    ...overrides,
  };
}

/**
 * Read-back mock for the happy path: the slug is free during the pre-flight
 * check, and the stored organization is visible after creation.
 */
function organizationAppearsAfterCreation(): ProvisioningDeps["findOrganizationBySlug"] {
  return vi.fn().mockResolvedValueOnce(null).mockResolvedValue(WORKSPACE);
}

function duplicateEmailError(): Error {
  return Object.assign(new Error("User already exists. Use another email."), {
    body: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" },
  });
}

function outputOf(result: ClientProvisioningResult, deps: ProvisioningDeps): string {
  const logs = vi
    .mocked(deps.log)
    .mock.calls.map((call) => call[0])
    .join("\n");
  return `${JSON.stringify(result)}\n${logs}`;
}

describe("authorization gate", () => {
  it("rejects an unauthenticated caller without reading or creating anything", async () => {
    const deps = createDeps({
      resolveOperatorAccess: vi.fn(
        async (): Promise<OperatorAccess> => ({ status: "unauthenticated" }),
      ),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toEqual({ status: "rejected" });
    expect(deps.findUserIdByEmail).not.toHaveBeenCalled();
    expect(deps.findOrganizationBySlug).not.toHaveBeenCalled();
    expect(deps.createClientUser).not.toHaveBeenCalled();
    expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
  });

  it("rejects an authenticated non-operator without reading or creating anything", async () => {
    const deps = createDeps({
      resolveOperatorAccess: vi.fn(
        async (): Promise<OperatorAccess> => ({
          status: "denied",
          user: { id: "client-user-9", email: "client@example.test", name: "Client" },
          allowlistProblem: null,
        }),
      ),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toEqual({ status: "rejected" });
    expect(deps.createClientUser).not.toHaveBeenCalled();
    expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it("fails closed when operator authorization cannot be verified", async () => {
    const deps = createDeps({
      resolveOperatorAccess: vi.fn(async () => {
        throw new Error("auth service unavailable");
      }),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toEqual({ status: "rejected" });
    expect(deps.createClientUser).not.toHaveBeenCalled();
  });

  it("checks authorization before validating input", async () => {
    const deps = createDeps({
      resolveOperatorAccess: vi.fn(
        async (): Promise<OperatorAccess> => ({ status: "unauthenticated" }),
      ),
    });

    const result = await provisionClientWorkspace(
      new Headers(),
      validInput({ companyName: "", ownerEmail: "not-an-email", initialPassword: "short" }),
      deps,
    );

    expect(result).toEqual({ status: "rejected" });
  });

  it("passes the request headers to the authorization resolver", async () => {
    const headers = new Headers({ cookie: "session=test-value" });
    const deps = createDeps();

    await provisionClientWorkspace(headers, validInput(), deps);

    expect(deps.resolveOperatorAccess).toHaveBeenCalledWith(headers);
  });
});

describe("input validation", () => {
  const invalidCases: Array<{
    label: string;
    input: ProvisioningInput;
    field: ProvisioningField;
  }> = [
    {
      label: "an empty company name",
      input: validInput({ companyName: "   " }),
      field: "company_name",
    },
    {
      label: "a company name without letters or digits",
      input: validInput({ companyName: "!!! ???" }),
      field: "company_name",
    },
    {
      label: "an overlong company name",
      input: validInput({ companyName: "a".repeat(101) }),
      field: "company_name",
    },
    {
      label: "an empty owner name",
      input: validInput({ ownerName: "  " }),
      field: "owner_name",
    },
    {
      label: "an invalid email",
      input: validInput({ ownerEmail: "not-an-email" }),
      field: "owner_email",
    },
    {
      label: "a short password",
      input: validInput({ initialPassword: "short" }),
      field: "password",
    },
    {
      label: "an overlong password",
      input: validInput({ initialPassword: "a".repeat(129) }),
      field: "password",
    },
    {
      label: "an invalid explicit slug",
      input: validInput({ organizationSlug: "Bad Slug!" }),
      field: "slug",
    },
    {
      label: "an overlong explicit slug",
      input: validInput({ organizationSlug: "a".repeat(49) }),
      field: "slug",
    },
    {
      label: "a non-string explicit slug",
      input: validInput({ organizationSlug: 123 }),
      field: "slug",
    },
  ];

  for (const { label, input, field } of invalidCases) {
    it(`rejects ${label} before touching the database or APIs`, async () => {
      const deps = createDeps();

      const result = await provisionClientWorkspace(new Headers(), input, deps);

      expect(result.status).toBe("invalid_input");
      if (result.status === "invalid_input") {
        expect(result.field).toBe(field);
        expect(result.message.length).toBeGreaterThan(0);
      }
      expect(deps.findUserIdByEmail).not.toHaveBeenCalled();
      expect(deps.findOrganizationBySlug).not.toHaveBeenCalled();
      expect(deps.createClientUser).not.toHaveBeenCalled();
      expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
    });
  }

  it("enforces the 8-128 character password policy even though the user API may not", async () => {
    const short = await provisionClientWorkspace(
      new Headers(),
      validInput({ initialPassword: "1234567" }),
      createDeps(),
    );
    expect(short).toMatchObject({ status: "invalid_input", field: "password" });

    const minimum = await provisionClientWorkspace(
      new Headers(),
      validInput({ initialPassword: "12345678" }),
      createDeps({ findOrganizationBySlug: organizationAppearsAfterCreation() }),
    );
    expect(minimum.status).toBe("provisioned");
  });
});

describe("successful provisioning", () => {
  it("creates the account and organization, then verifies the owner membership before success", async () => {
    const deps = createDeps({
      findOrganizationBySlug: organizationAppearsAfterCreation(),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toEqual({
      status: "provisioned",
      organizationId: "org-1",
      organizationName: "Acme Heating & Air",
      organizationSlug: "acme-heating-air",
      ownerUserId: "client-user-1",
      ownerEmail: "owner@example.test",
      ownerMembershipRole: "owner",
    });

    // The account is created with email, name, and password only: no role.
    const userCall = vi.mocked(deps.createClientUser).mock.calls[0]?.[0];
    expect(Object.keys(userCall ?? {})).toEqual(["email", "name", "password"]);
    expect(userCall?.email).toBe("owner@example.test");
    expect(userCall?.name).toBe("Alice Owner");

    // The organization is created for that exact account and the generated slug.
    const organizationCall =
      vi.mocked(deps.createOrganizationForOwner).mock.calls[0]?.[0];
    expect(organizationCall).toEqual({
      name: "Acme Heating & Air",
      slug: "acme-heating-air",
      ownerUserId: "client-user-1",
    });

    // The persisted organization and membership were read back (verification).
    expect(deps.findOrganizationBySlug).toHaveBeenCalledTimes(2);
    expect(deps.findMembership).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "client-user-1",
    });
    expect(deps.deleteUser).not.toHaveBeenCalled();

    expect(outputOf(result, deps)).not.toContain(VALID_PASSWORD);
  });

  it("uses an explicit alternative slug, normalized, and reports it", async () => {
    const deps = createDeps({
      findOrganizationBySlug: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: "org-1", name: "Acme Heating & Air", slug: "acme-north" }),
    });

    const result = await provisionClientWorkspace(
      new Headers(),
      validInput({ organizationSlug: "  Acme-North  " }),
      deps,
    );

    expect(result).toMatchObject({
      status: "provisioned",
      organizationSlug: "acme-north",
    });
    expect(vi.mocked(deps.createOrganizationForOwner).mock.calls[0]?.[0].slug).toBe(
      "acme-north",
    );
  });

  it("falls back to the generated slug when the explicit slug is blank", async () => {
    const deps = createDeps({
      findOrganizationBySlug: organizationAppearsAfterCreation(),
    });

    const result = await provisionClientWorkspace(
      new Headers(),
      validInput({ organizationSlug: "   " }),
      deps,
    );

    expect(result).toMatchObject({
      status: "provisioned",
      organizationSlug: "acme-heating-air",
    });
  });

  it("ignores client-supplied role and operator claims", async () => {
    const deps = createDeps({
      findOrganizationBySlug: organizationAppearsAfterCreation(),
    });
    const hostileInput: ProvisioningInput & Record<string, unknown> = {
      ...validInput(),
      role: "admin",
      isOperator: true,
      allowlist: "anyone",
    };

    const result = await provisionClientWorkspace(new Headers(), hostileInput, deps);

    expect(result.status).toBe("provisioned");
    const userCall = vi.mocked(deps.createClientUser).mock.calls[0]?.[0];
    expect(Object.keys(userCall ?? {})).toEqual(["email", "name", "password"]);
    const organizationCall =
      vi.mocked(deps.createOrganizationForOwner).mock.calls[0]?.[0];
    expect(Object.keys(organizationCall ?? {})).toEqual([
      "name",
      "slug",
      "ownerUserId",
    ]);
  });
});

describe("conflicts", () => {
  it("reports an existing email conflict without creating anything", async () => {
    const deps = createDeps({
      findUserIdByEmail: vi.fn(async () => "existing-user-1"),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toMatchObject({
      status: "conflict",
      field: "owner_email",
    });
    expect(deps.createClientUser).not.toHaveBeenCalled();
    expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
    expect(deps.findOrganizationBySlug).not.toHaveBeenCalled();
  });

  it("reports a slug conflict clearly without creating anything", async () => {
    const deps = createDeps({
      findOrganizationBySlug: vi.fn(async () => ({
        id: "other-org",
        name: "Other Org",
        slug: "acme-heating-air",
      })),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result.status).toBe("conflict");
    if (result.status === "conflict") {
      expect(result.field).toBe("slug");
      expect(result.message).toContain("acme-heating-air");
    }
    expect(deps.createClientUser).not.toHaveBeenCalled();
    expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
  });

  it("maps a duplicate-email error from the account API to the same conflict", async () => {
    const deps = createDeps({
      createClientUser: vi.fn(async () => {
        throw duplicateEmailError();
      }),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toMatchObject({
      status: "conflict",
      field: "owner_email",
    });
    expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
  });
});

describe("failure handling and recovery", () => {
  it("reports a clean, retryable failure when the account API fails and no account exists", async () => {
    const deps = createDeps({
      createClientUser: vi.fn(async () => {
        throw new Error("account api unavailable");
      }),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toEqual({
      status: "failed",
      message: "The client account could not be created. Nothing was changed; you can retry.",
      recovery: {
        ownerEmail: "owner@example.test",
        ownerUserId: null,
        ownerAccountExists: false,
        accountCleanup: "not-needed",
        organizationExists: null,
      },
    });
    expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it("never deletes an account whose creation was not confirmed by this operation", async () => {
    const deps = createDeps({
      createClientUser: vi.fn(async () => {
        throw new Error("connection reset");
      }),
      findUserIdByEmail: vi.fn().mockResolvedValueOnce(null).mockResolvedValue("observed-user-1"),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.recovery.ownerUserId).toBe("observed-user-1");
      expect(result.recovery.ownerAccountExists).toBe(true);
      expect(result.recovery.accountCleanup).toBe("not-attempted");
      expect(result.recovery.organizationExists).toBeNull();
    }
    expect(deps.deleteUser).not.toHaveBeenCalled();
    expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
  });

  it("reports an explicit unknown state when the account lookup itself fails", async () => {
    const deps = createDeps({
      createClientUser: vi.fn(async () => {
        throw new Error("connection reset");
      }),
      findUserIdByEmail: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValue(new Error("database unavailable")),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.recovery.ownerAccountExists).toBeNull();
      expect(result.recovery.accountCleanup).toBe("not-attempted");
    }
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it("treats a missing user ID from the account API as a failure", async () => {
    const deps = createDeps({
      createClientUser: vi.fn(async () => ({ id: "" })),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toMatchObject({
      status: "failed",
      recovery: { ownerAccountExists: false, accountCleanup: "not-needed" },
    });
    expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
  });

  it("removes the exact created account when the organization was not created, and verifies removal", async () => {
    const deps = createDeps({
      createOrganizationForOwner: vi.fn(async () => {
        throw new Error("organization api failed");
      }),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toEqual({
      status: "failed",
      message:
        "Provisioning failed and the client account was removed. Nothing was changed; you can retry.",
      recovery: {
        ownerEmail: "owner@example.test",
        ownerUserId: "client-user-1",
        ownerAccountExists: false,
        accountCleanup: "removed",
        organizationExists: false,
      },
    });
    expect(deps.deleteUser).toHaveBeenCalledTimes(1);
    expect(deps.deleteUser).toHaveBeenCalledWith("client-user-1");
    expect(deps.createOrganizationForOwner).toHaveBeenCalledTimes(1);
  });

  it("removes the created account and reports the existing workspace record when the owner membership is missing", async () => {
    const deps = createDeps({
      createOrganizationForOwner: vi.fn(async () => {
        throw new Error("organization api failed");
      }),
      findOrganizationBySlug: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(WORKSPACE),
      findMembership: vi.fn(async () => null),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.message).toContain("acme-heating-air");
      expect(result.recovery.organizationExists).toBe(true);
      expect(result.recovery.accountCleanup).toBe("removed");
      expect(result.recovery.ownerAccountExists).toBe(false);
    }
    expect(deps.deleteUser).toHaveBeenCalledWith("client-user-1");
    expect(deps.findMembership).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "client-user-1",
    });
  });

  it("reports verified success when the persisted state is complete despite an organization API error", async () => {
    const deps = createDeps({
      createOrganizationForOwner: vi.fn(async () => {
        throw new Error("connection reset after commit");
      }),
      findOrganizationBySlug: organizationAppearsAfterCreation(),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toMatchObject({
      status: "provisioned",
      organizationId: "org-1",
      ownerUserId: "client-user-1",
      ownerMembershipRole: "owner",
    });
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it("never reports success when the created organization has no owner membership", async () => {
    const deps = createDeps({
      findOrganizationBySlug: organizationAppearsAfterCreation(),
      findMembership: vi.fn(async () => null),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.recovery.organizationExists).toBe(true);
      expect(result.recovery.accountCleanup).toBe("removed");
    }
    expect(deps.deleteUser).toHaveBeenCalledWith("client-user-1");
  });

  it("does not clean up when the workspace state cannot be determined", async () => {
    const deps = createDeps({
      findOrganizationBySlug: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValue(new Error("database unavailable")),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.recovery.organizationExists).toBeNull();
      expect(result.recovery.accountCleanup).toBe("not-attempted");
      expect(result.recovery.ownerAccountExists).toBe(true);
    }
    expect(deps.deleteUser).not.toHaveBeenCalled();
    expect(result.status === "failed" && result.message).toContain("no automatic cleanup");
  });

  it("does not clean up when the owner membership cannot be verified", async () => {
    const deps = createDeps({
      findOrganizationBySlug: organizationAppearsAfterCreation(),
      findMembership: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.recovery.organizationExists).toBe(true);
      expect(result.recovery.accountCleanup).toBe("not-attempted");
    }
    expect(deps.deleteUser).not.toHaveBeenCalled();
  });

  it("reports explicitly when the created account cannot be removed", async () => {
    const deps = createDeps({
      createOrganizationForOwner: vi.fn(async () => {
        throw new Error("organization api failed");
      }),
      deleteUser: vi.fn(async () => {
        throw new Error("delete failed");
      }),
      findUserIdByEmail: vi.fn().mockResolvedValueOnce(null).mockResolvedValue("client-user-1"),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.recovery.accountCleanup).toBe("not-removed");
      expect(result.recovery.ownerAccountExists).toBe(true);
      expect(result.recovery.organizationExists).toBe(false);
      expect(result.message).toContain("owner@example.test");
      expect(result.message).toContain("client-user-1");
    }
  });

  it("reports an unverified removal when the removal cannot be confirmed", async () => {
    const deps = createDeps({
      createOrganizationForOwner: vi.fn(async () => {
        throw new Error("organization api failed");
      }),
      findUserIdByEmail: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockRejectedValue(new Error("database unavailable")),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.recovery.accountCleanup).toBe("unverified");
      expect(result.recovery.ownerAccountExists).toBeNull();
    }
    expect(deps.deleteUser).toHaveBeenCalledWith("client-user-1");
  });

  it("reports a clean failure when the pre-flight checks cannot run", async () => {
    const deps = createDeps({
      findUserIdByEmail: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    const result = await provisionClientWorkspace(new Headers(), validInput(), deps);

    expect(result).toMatchObject({
      status: "failed",
      recovery: {
        accountCleanup: "not-needed",
        ownerAccountExists: null,
        organizationExists: null,
      },
    });
    expect(deps.createClientUser).not.toHaveBeenCalled();
    expect(deps.createOrganizationForOwner).not.toHaveBeenCalled();
  });

  it("never includes the password in results or logs across scenarios", async () => {
    const password = "unique-client-password-42";
    const scenarios: Array<{ input: ProvisioningInput; deps: ProvisioningDeps }> = [
      {
        input: validInput({ initialPassword: password }),
        deps: createDeps({ findOrganizationBySlug: organizationAppearsAfterCreation() }),
      },
      {
        input: validInput({ initialPassword: password }),
        deps: createDeps({
          createClientUser: vi.fn(async () => {
            throw new Error("boom");
          }),
        }),
      },
      {
        input: validInput({ initialPassword: password }),
        deps: createDeps({
          createClientUser: vi.fn(async () => {
            throw duplicateEmailError();
          }),
        }),
      },
      {
        input: validInput({ initialPassword: password }),
        deps: createDeps({
          createOrganizationForOwner: vi.fn(async () => {
            throw new Error("boom");
          }),
        }),
      },
      {
        input: validInput({ initialPassword: password }),
        deps: createDeps({
          findOrganizationBySlug: organizationAppearsAfterCreation(),
          findMembership: vi.fn(async () => null),
        }),
      },
    ];

    for (const scenario of scenarios) {
      const result = await provisionClientWorkspace(
        new Headers(),
        scenario.input,
        scenario.deps,
      );
      expect(outputOf(result, scenario.deps)).not.toContain(password);
    }
  });
});

describe("generateOrganizationSlug", () => {
  it.each([
    ["Bob's Heating & Air, Inc.", "bob-s-heating-air-inc"],
    ["  Acme  Heating  ", "acme-heating"],
    ["Café Climático", "cafe-climatico"],
    ["HVAC Élite #1", "hvac-elite-1"],
    ["!!! ???", ""],
  ])("turns %j into %j", (companyName, expected) => {
    expect(generateOrganizationSlug(companyName)).toBe(expected);
  });

  it("caps generated slugs at the supported length without a trailing hyphen", () => {
    const slug = generateOrganizationSlug("Very Long Company Name ".repeat(5).trim());

    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
