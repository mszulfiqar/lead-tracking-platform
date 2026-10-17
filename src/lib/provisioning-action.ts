/**
 * Operator console create-client action logic.
 *
 * The exported `"use server"` entry point in `src/app/operator/actions.ts` is
 * a thin wrapper around `executeProvisionClientRequest`, which stays separate
 * so it can be exercised by integration tests with real request headers and
 * the real provisioning service (no `next/headers` mocking needed).
 *
 * Authorization is deliberately not re-implemented here: the provisioning
 * service re-verifies the platform-operator allowlist against the request
 * headers before anything is read or created, so a client calling this action
 * directly can never provision. This module only performs the form-level
 * confirmation check and maps the service result onto the form state.
 */
import { provisionClientWorkspaceForRequest } from "./client-provisioning-server";
import type { ProvisioningInput } from "./client-provisioning";
import {
  checkConfirmPassword,
  readProvisionClientFormValues,
  toProvisionClientActionState,
  type ProvisionClientActionState,
} from "./provisioning-form";

export async function executeProvisionClientRequest(
  requestHeaders: Headers,
  formData: FormData,
): Promise<ProvisionClientActionState> {
  const values = readProvisionClientFormValues(formData);

  const confirmation = checkConfirmPassword(
    values.initialPassword,
    values.confirmPassword,
  );
  if (!confirmation.ok) {
    return {
      status: "invalid_input",
      field: "confirmPassword",
      message: confirmation.message,
    };
  }

  const input: ProvisioningInput = {
    companyName: values.companyName,
    organizationSlug: values.organizationSlug,
    ownerName: values.ownerName,
    ownerEmail: values.ownerEmail,
    initialPassword: values.initialPassword,
  };

  const result = await provisionClientWorkspaceForRequest(requestHeaders, input);
  return toProvisionClientActionState(result);
}
