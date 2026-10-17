import { describe, expect, it } from "vitest";

import type {
  ClientProvisioningResult,
  ProvisioningRecovery,
} from "../../src/lib/client-provisioning";
import {
  checkConfirmPassword,
  fieldErrorFor,
  initialProvisionClientState,
  readProvisionClientFormValues,
  summaryFor,
  toProvisionClientActionState,
} from "../../src/lib/provisioning-form";

/**
 * Unit tests for the client-safe form state model used by the operator
 * console create-client form and its server action. Everything here is pure:
 * no database, no authentication, no Next.js runtime.
 */

function recoveryFixture(
  overrides: Partial<ProvisioningRecovery> = {},
): ProvisioningRecovery {
  return {
    ownerEmail: "owner@example.test",
    ownerUserId: "user-1",
    ownerAccountExists: false,
    accountCleanup: "removed",
    organizationExists: false,
    ...overrides,
  };
}

describe("readProvisionClientFormValues", () => {
  it("reads all submitted values from form data", () => {
    const formData = new FormData();
    formData.set("companyName", "Northwind Mechanical");
    formData.set("organizationSlug", "northwind-mechanical");
    formData.set("ownerName", "Casey Owner");
    formData.set("ownerEmail", "casey@example.test");
    formData.set("initialPassword", "initial-password-1");
    formData.set("confirmPassword", "initial-password-1");

    expect(readProvisionClientFormValues(formData)).toEqual({
      companyName: "Northwind Mechanical",
      organizationSlug: "northwind-mechanical",
      ownerName: "Casey Owner",
      ownerEmail: "casey@example.test",
      initialPassword: "initial-password-1",
      confirmPassword: "initial-password-1",
    });
  });

  it("treats missing and non-string entries as empty strings", () => {
    const formData = new FormData();
    formData.set("ownerEmail", new Blob(["not-a-string"]));

    expect(readProvisionClientFormValues(formData)).toEqual({
      companyName: "",
      organizationSlug: "",
      ownerName: "",
      ownerEmail: "",
      initialPassword: "",
      confirmPassword: "",
    });
  });
});

describe("checkConfirmPassword", () => {
  it("accepts a matching confirmation", () => {
    expect(checkConfirmPassword("initial-password-1", "initial-password-1")).toEqual(
      { ok: true },
    );
  });

  it("rejects a mismatched confirmation without echoing any value", () => {
    const result = checkConfirmPassword("initial-password-1", "different-value");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("initial-password-1");
      expect(result.message).not.toContain("different-value");
    }
  });

  it("rejects non-string values", () => {
    expect(checkConfirmPassword(new Blob(["x"]), new Blob(["x"])).ok).toBe(false);
    expect(checkConfirmPassword(undefined, undefined).ok).toBe(false);
  });
});

describe("toProvisionClientActionState", () => {
  it("maps a verified success to display facts only", () => {
    const result: ClientProvisioningResult = {
      status: "provisioned",
      organizationId: "org-internal-id",
      organizationName: "Northwind Mechanical",
      organizationSlug: "northwind-mechanical",
      ownerUserId: "user-internal-id",
      ownerEmail: "casey@example.test",
      ownerMembershipRole: "owner",
    };

    const state = toProvisionClientActionState(result);
    expect(state).toEqual({
      status: "provisioned",
      organizationName: "Northwind Mechanical",
      organizationSlug: "northwind-mechanical",
      ownerEmail: "casey@example.test",
    });
    // Internal identifiers are not needed by the UI.
    expect(Object.keys(state).sort()).toEqual([
      "organizationName",
      "organizationSlug",
      "ownerEmail",
      "status",
    ]);
  });

  it("maps every validation field onto its form field", () => {
    const cases = [
      { serviceField: "company_name", formField: "companyName" },
      { serviceField: "slug", formField: "organizationSlug" },
      { serviceField: "owner_name", formField: "ownerName" },
      { serviceField: "owner_email", formField: "ownerEmail" },
      { serviceField: "password", formField: "initialPassword" },
    ] as const;

    for (const { serviceField, formField } of cases) {
      const state = toProvisionClientActionState({
        status: "invalid_input",
        field: serviceField,
        message: "Example validation message.",
      });
      expect(state).toEqual({
        status: "invalid_input",
        field: formField,
        message: "Example validation message.",
      });
    }
  });

  it("maps conflicts onto the email and slug fields", () => {
    expect(
      toProvisionClientActionState({
        status: "conflict",
        field: "owner_email",
        message: "duplicate email",
      }),
    ).toEqual({
      status: "conflict",
      field: "ownerEmail",
      message: "duplicate email",
    });
    expect(
      toProvisionClientActionState({
        status: "conflict",
        field: "slug",
        message: "duplicate slug",
      }),
    ).toEqual({
      status: "conflict",
      field: "organizationSlug",
      message: "duplicate slug",
    });
  });

  it("maps rejected without adding any detail", () => {
    expect(toProvisionClientActionState({ status: "rejected" })).toEqual({
      status: "rejected",
    });
  });

  it("passes the failed message and recovery state through unchanged", () => {
    const recovery = recoveryFixture({
      ownerAccountExists: true,
      accountCleanup: "not-attempted",
      organizationExists: null,
    });
    const state = toProvisionClientActionState({
      status: "failed",
      message: "Could not verify the resulting state.",
      recovery,
    });
    expect(state).toEqual({
      status: "failed",
      message: "Could not verify the resulting state.",
      recovery,
    });
    // No password-like field can ever appear in the displayed state.
    expect(JSON.stringify(state)).not.toContain("password");
  });
});

describe("fieldErrorFor", () => {
  it("renders a validation message only under the affected field", () => {
    const state = toProvisionClientActionState({
      status: "invalid_input",
      field: "company_name",
      message: "Enter the client company name.",
    });
    expect(fieldErrorFor(state, "companyName")).toBe(
      "Enter the client company name.",
    );
    expect(fieldErrorFor(state, "organizationSlug")).toBeNull();
    expect(fieldErrorFor(state, "ownerName")).toBeNull();
    expect(fieldErrorFor(state, "ownerEmail")).toBeNull();
    expect(fieldErrorFor(state, "initialPassword")).toBeNull();
    expect(fieldErrorFor(state, "confirmPassword")).toBeNull();
  });

  it("renders conflicts under the email or slug field", () => {
    const emailConflict = toProvisionClientActionState({
      status: "conflict",
      field: "owner_email",
      message: "An account already exists for this email address.",
    });
    expect(fieldErrorFor(emailConflict, "ownerEmail")).toBe(
      "An account already exists for this email address.",
    );
    expect(fieldErrorFor(emailConflict, "organizationSlug")).toBeNull();

    const slugConflict = toProvisionClientActionState({
      status: "conflict",
      field: "slug",
      message: "The workspace link is already in use.",
    });
    expect(fieldErrorFor(slugConflict, "organizationSlug")).toBe(
      "The workspace link is already in use.",
    );
    expect(fieldErrorFor(slugConflict, "ownerEmail")).toBeNull();
  });

  it("renders no field error for idle, success, rejected, or failed states", () => {
    const states = [
      initialProvisionClientState,
      toProvisionClientActionState({
        status: "provisioned",
        organizationId: "org-1",
        organizationName: "Northwind",
        organizationSlug: "northwind",
        ownerUserId: "user-1",
        ownerEmail: "owner@example.test",
        ownerMembershipRole: "owner",
      }),
      toProvisionClientActionState({ status: "rejected" }),
      toProvisionClientActionState({
        status: "failed",
        message: "failed",
        recovery: recoveryFixture(),
      }),
    ];

    for (const state of states) {
      for (const field of [
        "companyName",
        "organizationSlug",
        "ownerName",
        "ownerEmail",
        "initialPassword",
        "confirmPassword",
      ] as const) {
        expect(fieldErrorFor(state, field)).toBeNull();
      }
    }
  });
});

describe("summaryFor", () => {
  it("renders nothing for the untouched form", () => {
    expect(summaryFor(initialProvisionClientState)).toBeNull();
  });

  it("reports verified success with handover guidance and no password", () => {
    const summary = summaryFor({
      status: "provisioned",
      organizationName: "Northwind Mechanical",
      organizationSlug: "northwind-mechanical",
      ownerEmail: "casey@example.test",
    });
    expect(summary?.tone).toBe("success");
    expect(summary?.manualRecoveryRequired).toBe(false);
    expect(summary?.message).toContain("Northwind Mechanical");
    expect(summary?.message).toContain("northwind-mechanical");
    expect(summary?.message).toContain("never shown or stored again");
  });

  it("reports authorization rejection as an error", () => {
    const summary = summaryFor({ status: "rejected" });
    expect(summary?.tone).toBe("error");
    expect(summary?.message).toContain("not authorized");
    expect(summary?.manualRecoveryRequired).toBe(false);
  });

  it("passes validation and conflict messages through", () => {
    expect(
      summaryFor({
        status: "invalid_input",
        field: "initialPassword",
        message: "The initial password must be at least 8 characters.",
      })?.message,
    ).toBe("The initial password must be at least 8 characters.");

    const conflict = summaryFor({
      status: "conflict",
      field: "organizationSlug",
      message: "The workspace link is already in use.",
    });
    expect(conflict?.tone).toBe("warning");
    expect(conflict?.message).toBe("The workspace link is already in use.");
  });

  it("requires manual recovery whenever state may remain behind", () => {
    const cases: Array<{
      recovery: ProvisioningRecovery;
      manualRecoveryRequired: boolean;
    }> = [
      {
        // Account removed and no organization: cleanly recovered.
        recovery: recoveryFixture({
          accountCleanup: "removed",
          organizationExists: false,
        }),
        manualRecoveryRequired: false,
      },
      {
        // Nothing was created at all: cleanly recovered.
        recovery: recoveryFixture({
          ownerUserId: null,
          ownerAccountExists: null,
          accountCleanup: "not-needed",
          organizationExists: null,
        }),
        manualRecoveryRequired: false,
      },
      {
        // Account deliberately left in place.
        recovery: recoveryFixture({
          ownerAccountExists: true,
          accountCleanup: "not-attempted",
          organizationExists: null,
        }),
        manualRecoveryRequired: true,
      },
      {
        // Removal failed.
        recovery: recoveryFixture({
          ownerAccountExists: true,
          accountCleanup: "not-removed",
          organizationExists: false,
        }),
        manualRecoveryRequired: true,
      },
      {
        // Removal could not be verified.
        recovery: recoveryFixture({
          ownerAccountExists: null,
          accountCleanup: "unverified",
          organizationExists: false,
        }),
        manualRecoveryRequired: true,
      },
      {
        // An organization record exists without the verified owner.
        recovery: recoveryFixture({
          accountCleanup: "removed",
          organizationExists: true,
        }),
        manualRecoveryRequired: true,
      },
    ];

    for (const { recovery, manualRecoveryRequired } of cases) {
      const summary = summaryFor({
        status: "failed",
        message: "Provisioning did not complete.",
        recovery,
      });
      expect(summary?.tone).toBe("error");
      expect(summary?.title).toBe("Provisioning did not complete");
      expect(summary?.message).toBe("Provisioning did not complete.");
      expect(summary?.manualRecoveryRequired).toBe(manualRecoveryRequired);
    }
  });
});
