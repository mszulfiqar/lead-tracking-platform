"use server";

/**
 * Server actions for the operator console.
 *
 * This file only binds the request headers to the provisioning action logic
 * in `src/lib/provisioning-action.ts`. The provisioning service behind it
 * re-verifies the platform-operator allowlist on the server for every call,
 * so hiding or showing this form client-side is never what grants access.
 */
import { headers } from "next/headers";

import { executeProvisionClientRequest } from "../../lib/provisioning-action";
import type { ProvisionClientActionState } from "../../lib/provisioning-form";

export async function createClientOrganization(
  previousState: ProvisionClientActionState,
  formData: FormData,
): Promise<ProvisionClientActionState> {
  void previousState;
  return executeProvisionClientRequest(await headers(), formData);
}
