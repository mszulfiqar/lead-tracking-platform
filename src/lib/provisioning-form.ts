/**
 * Client-safe state model for the operator's create-client form.
 *
 * This module is imported by both the browser form component
 * (`src/components/provision-client-form.tsx`) and the server action logic
 * (`src/lib/provisioning-action.ts`), so it must stay free of database,
 * authentication, and `next/*` imports. Everything here is pure: reading
 * submitted form values, the confirmation check, and the mapping of the
 * provisioning result onto the form's displayed state.
 *
 * Passwords pass through this module only as in-memory values that are
 * handed to the provisioning service. They are never stored in the action
 * state, echoed in messages, or written anywhere.
 */
import type {
  ClientProvisioningResult,
  ProvisioningField,
  ProvisioningRecovery,
} from "./client-provisioning";

export interface ProvisionClientFormValues {
  companyName: string;
  organizationSlug: string;
  ownerName: string;
  ownerEmail: string;
  initialPassword: string;
  confirmPassword: string;
}

/** Form fields, named after their input `name` attributes. */
export type ProvisionClientFormField =
  | "companyName"
  | "organizationSlug"
  | "ownerName"
  | "ownerEmail"
  | "initialPassword"
  | "confirmPassword";

/**
 * State returned by the `createClientOrganization` server action and rendered
 * by the form. Success carries only the verified organization facts and the
 * owner email — never the password, and never internal identifiers the
 * operator does not need.
 */
export type ProvisionClientActionState =
  | { status: "idle" }
  | {
      status: "provisioned";
      organizationName: string;
      organizationSlug: string;
      ownerEmail: string;
    }
  | {
      status: "invalid_input";
      field: ProvisionClientFormField;
      message: string;
    }
  | {
      status: "conflict";
      field: "ownerEmail" | "organizationSlug";
      message: string;
    }
  | { status: "rejected" }
  | { status: "failed"; message: string; recovery: ProvisioningRecovery };

export const initialProvisionClientState: ProvisionClientActionState = {
  status: "idle",
};

/** Reads the submitted form values; non-string entries become empty strings. */
export function readProvisionClientFormValues(
  formData: FormData,
): ProvisionClientFormValues {
  function read(name: string): string {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  }
  return {
    companyName: read("companyName"),
    organizationSlug: read("organizationSlug"),
    ownerName: read("ownerName"),
    ownerEmail: read("ownerEmail"),
    initialPassword: read("initialPassword"),
    confirmPassword: read("confirmPassword"),
  };
}

/**
 * Checks the confirmation field against the initial password before anything
 * is submitted to the provisioning service. The message never contains any
 * part of the password.
 */
export function checkConfirmPassword(
  initialPassword: unknown,
  confirmPassword: unknown,
): { ok: true } | { ok: false; message: string } {
  if (
    typeof initialPassword !== "string" ||
    typeof confirmPassword !== "string" ||
    initialPassword !== confirmPassword
  ) {
    return {
      ok: false,
      message: "The initial password and the confirmation do not match.",
    };
  }
  return { ok: true };
}

const SERVICE_FIELD_TO_FORM_FIELD: Record<
  ProvisioningField,
  ProvisionClientFormField
> = {
  company_name: "companyName",
  slug: "organizationSlug",
  owner_name: "ownerName",
  owner_email: "ownerEmail",
  password: "initialPassword",
};

/**
 * Maps the provisioning service result onto the form's displayed state. The
 * mapping never adds information: in particular, the password is not present
 * in the service result and cannot appear here.
 */
export function toProvisionClientActionState(
  result: ClientProvisioningResult,
): ProvisionClientActionState {
  switch (result.status) {
    case "provisioned":
      return {
        status: "provisioned",
        organizationName: result.organizationName,
        organizationSlug: result.organizationSlug,
        ownerEmail: result.ownerEmail,
      };
    case "invalid_input":
      return {
        status: "invalid_input",
        field: SERVICE_FIELD_TO_FORM_FIELD[result.field],
        message: result.message,
      };
    case "conflict":
      return {
        status: "conflict",
        field: result.field === "owner_email" ? "ownerEmail" : "organizationSlug",
        message: result.message,
      };
    case "rejected":
      return { status: "rejected" };
    case "failed":
      return { status: "failed", message: result.message, recovery: result.recovery };
  }
}

/** The error message to render under a specific field, if any. */
export function fieldErrorFor(
  state: ProvisionClientActionState,
  field: ProvisionClientFormField,
): string | null {
  if (state.status === "invalid_input" || state.status === "conflict") {
    return state.field === field ? state.message : null;
  }
  return null;
}

export interface ProvisionClientSummary {
  tone: "success" | "warning" | "error";
  title: string;
  message: string;
  /**
   * True when provisioning left state behind (or could not prove it did not)
   * and a human must verify or clean up before treating the client as
   * onboarded. Never rendered as success.
   */
  manualRecoveryRequired: boolean;
}

/**
 * Summarizes the action state for the form's result panel. Returns `null` for
 * the untouched form.
 */
export function summaryFor(
  state: ProvisionClientActionState,
): ProvisionClientSummary | null {
  switch (state.status) {
    case "idle":
      return null;
    case "provisioned":
      return {
        tone: "success",
        title: "Client workspace provisioned",
        message:
          `"${state.organizationName}" is ready with the workspace link "${state.organizationSlug}". ` +
          "Hand the client owner the email address and the initial password you entered. " +
          "The password is never shown or stored again, so it cannot be retrieved later.",
        manualRecoveryRequired: false,
      };
    case "invalid_input":
      return {
        tone: "error",
        title: "Check the highlighted field",
        message: state.message,
        manualRecoveryRequired: false,
      };
    case "conflict":
      return {
        tone: "warning",
        title: "Could not provision this client",
        message: state.message,
        manualRecoveryRequired: false,
      };
    case "rejected":
      return {
        tone: "error",
        title: "Not authorized",
        message: "You are not authorized to create client workspaces.",
        manualRecoveryRequired: false,
      };
    case "failed": {
      const cleanlyRecovered =
        (state.recovery.accountCleanup === "removed" ||
          state.recovery.accountCleanup === "not-needed") &&
        state.recovery.organizationExists !== true;
      return {
        tone: "error",
        title: "Provisioning did not complete",
        message: state.message,
        manualRecoveryRequired: !cleanlyRecovered,
      };
    }
  }
}
