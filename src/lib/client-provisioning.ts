/**
 * Operator-managed client provisioning: workspace organization, client owner
 * account, and initial password (logic only; the server wiring lives in
 * `client-provisioning-server.ts`).
 *
 * The flow is deliberately dependency-injected so every guardrail and every
 * failure branch can be exercised by automated tests without a database:
 *
 * 1. The caller must present a verified platform-operator session
 *    (`resolveOperatorAccess`); nothing is validated, read, or created
 *    otherwise.
 * 2. Company name, workspace link (slug), owner name, email, and initial
 *    password are validated at this boundary. The password is checked against
 *    the shared initial-password policy (8-128 characters) and never logged,
 *    persisted, or returned in results or error messages.
 * 3. The workspace link is generated from the company name, or taken from an
 *    explicit alternative. Conflicts are reported as actionable errors; the
 *    slug is never silently changed and the client is never associated with
 *    another organization.
 * 4. The client account is created through the caller-provided server-side
 *    user API with the default `user` role. Platform-operator privileges come
 *    exclusively from the `PLATFORM_OPERATOR_USER_IDS` allowlist, so this flow
 *    can never grant them.
 * 5. The organization is created through the caller-provided server-side
 *    organization API for that exact account, with the client as its creator
 *    (`owner` membership role).
 * 6. Success is reported only after the persisted organization and the
 *    `owner` membership have been read back and verified.
 *
 * Account creation and organization creation are separate API calls and are
 * not one atomic transaction. This flow therefore decides by *verified state*
 * rather than by assumed call outcomes:
 * - if no organization exists for the target link, the exact account created
 *   by this operation is removed (and its removal verified);
 * - if the organization exists with this client as verified `owner`, the
 *   operation is reported as provisioned, even if an earlier call threw;
 * - when the state cannot be determined or cannot be cleaned up, an explicit
 *   recoverable failure state is returned instead of success. Records that
 *   were not demonstrably created by this operation are never deleted, and
 *   pre-existing organizations are never modified.
 */
import {
  INITIAL_PASSWORD_MAX_LENGTH,
  INITIAL_PASSWORD_MIN_LENGTH,
  validateInitialPassword,
} from "./password-policy";
import type { OperatorAccess } from "./operator-access";

export const COMPANY_NAME_MAX_LENGTH = 100;
export const OWNER_NAME_MAX_LENGTH = 100;
export const OWNER_EMAIL_MAX_LENGTH = 254;
export const ORGANIZATION_SLUG_MAX_LENGTH = 48;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ProvisioningField =
  | "company_name"
  | "slug"
  | "owner_name"
  | "owner_email"
  | "password";

export interface ProvisioningInput {
  companyName: unknown;
  /** Optional explicit alternative slug; blank means "generate from the name". */
  organizationSlug?: unknown;
  ownerName: unknown;
  ownerEmail: unknown;
  initialPassword: unknown;
}

export interface StoredOrganization {
  id: string;
  name: string;
  slug: string;
}

export interface StoredMembership {
  role: string;
}

export interface ProvisioningRecovery {
  /** Email of the client owner account this operation attempted to create. */
  ownerEmail: string;
  /**
   * User ID of the client account when known: the account created by this
   * operation, or an account observed for the same email after an ambiguous
   * failure. `null` when no account could be identified.
   */
  ownerUserId: string | null;
  /** Observed account state after the failure. `null` means "not determined". */
  ownerAccountExists: boolean | null;
  /**
   * Outcome of the cleanup attempt for the account created by this operation:
   * - `not-needed`: no account created by this operation remained;
   * - `removed`: the account was deleted and its absence verified;
   * - `not-removed`: the account may still exist (deletion failed or had no effect);
   * - `unverified`: deletion was attempted but its result could not be verified;
   * - `not-attempted`: an account created by this operation was deliberately left in place.
   */
  accountCleanup:
    | "not-needed"
    | "removed"
    | "not-removed"
    | "unverified"
    | "not-attempted";
  /**
   * Organization state for the target slug after the failure, determined by a
   * fresh read. `null` means "not determined".
   */
  organizationExists: boolean | null;
}

export type ClientProvisioningResult =
  | {
      status: "provisioned";
      organizationId: string;
      organizationName: string;
      organizationSlug: string;
      ownerUserId: string;
      ownerEmail: string;
      ownerMembershipRole: "owner";
    }
  | { status: "rejected" }
  | { status: "invalid_input"; field: ProvisioningField; message: string }
  | { status: "conflict"; field: "owner_email" | "slug"; message: string }
  | { status: "failed"; message: string; recovery: ProvisioningRecovery };

export interface ProvisioningDeps {
  /** Server-side operator authorization: the single entry gate. */
  resolveOperatorAccess(requestHeaders: Headers): Promise<OperatorAccess>;
  findUserIdByEmail(email: string): Promise<string | null>;
  findOrganizationBySlug(slug: string): Promise<StoredOrganization | null>;
  createClientUser(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<{ id: string }>;
  /** Server-side organization creation without session headers. */
  createOrganizationForOwner(input: {
    name: string;
    slug: string;
    ownerUserId: string;
  }): Promise<{ id: string }>;
  findMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<StoredMembership | null>;
  /**
   * Deletes exactly the user row with this ID (cascades sessions, accounts,
   * and memberships). Implementations must never delete by any wider
   * criterion.
   */
  deleteUser(userId: string): Promise<void>;
  /** Receives progress messages only. Never pass passwords or secrets. */
  log(message: string): void;
}

/**
 * Deterministic workspace link for a company name: accents folded,
 * lowercased, every run of other characters collapsed to a single hyphen,
 * trimmed, and capped at `ORGANIZATION_SLUG_MAX_LENGTH` without leaving a
 * trailing hyphen. May return `""` for names without letters or digits;
 * callers must treat that as invalid input rather than assigning it.
 */
export function generateOrganizationSlug(companyName: string): string {
  return companyName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ORGANIZATION_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

export type ProvisioningValidation =
  | {
      ok: true;
      value: {
        companyName: string;
        organizationSlug: string;
        ownerName: string;
        ownerEmail: string;
        initialPassword: string;
      };
    }
  | { ok: false; field: ProvisioningField; message: string };

function invalid(
  field: ProvisioningField,
  message: string,
): ProvisioningValidation {
  return { ok: false, field, message };
}

function slugFormatMessage(): string {
  return `The workspace link must use lowercase letters, numbers, and single hyphens (up to ${ORGANIZATION_SLUG_MAX_LENGTH} characters).`;
}

/**
 * Validates and normalizes provisioning input at the server boundary. The
 * password is only checked against the shared policy; it is never included in
 * any message.
 */
export function validateProvisioningInput(
  input: ProvisioningInput,
): ProvisioningValidation {
  if (typeof input.companyName !== "string" || input.companyName.trim() === "") {
    return invalid("company_name", "Enter the client company name.");
  }
  const companyName = input.companyName.trim();
  if (companyName.length > COMPANY_NAME_MAX_LENGTH) {
    return invalid(
      "company_name",
      `The company name must be ${COMPANY_NAME_MAX_LENGTH} characters or fewer.`,
    );
  }

  const rawSlug = input.organizationSlug;
  if (rawSlug !== undefined && rawSlug !== null && typeof rawSlug !== "string") {
    return invalid("slug", slugFormatMessage());
  }
  const explicitSlug =
    typeof rawSlug === "string" ? rawSlug.trim().toLowerCase() : "";

  let organizationSlug: string;
  if (explicitSlug !== "") {
    if (
      !SLUG_PATTERN.test(explicitSlug) ||
      explicitSlug.length > ORGANIZATION_SLUG_MAX_LENGTH
    ) {
      return invalid("slug", slugFormatMessage());
    }
    organizationSlug = explicitSlug;
  } else {
    organizationSlug = generateOrganizationSlug(companyName);
    if (organizationSlug === "") {
      return invalid(
        "company_name",
        "The company name must contain at least one letter or number so a workspace link can be generated.",
      );
    }
  }

  if (typeof input.ownerName !== "string" || input.ownerName.trim() === "") {
    return invalid("owner_name", "Enter the client owner's name.");
  }
  const ownerName = input.ownerName.trim();
  if (ownerName.length > OWNER_NAME_MAX_LENGTH) {
    return invalid(
      "owner_name",
      `The owner name must be ${OWNER_NAME_MAX_LENGTH} characters or fewer.`,
    );
  }

  if (typeof input.ownerEmail !== "string" || input.ownerEmail.trim() === "") {
    return invalid("owner_email", "Enter the client owner's email address.");
  }
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (ownerEmail.length > OWNER_EMAIL_MAX_LENGTH) {
    return invalid(
      "owner_email",
      `The email address must be ${OWNER_EMAIL_MAX_LENGTH} characters or fewer.`,
    );
  }
  if (!EMAIL_PATTERN.test(ownerEmail)) {
    return invalid("owner_email", "Enter a valid email address.");
  }

  const passwordCheck = validateInitialPassword(input.initialPassword);
  if (!passwordCheck.ok) {
    if (passwordCheck.reason === "too_long") {
      return invalid(
        "password",
        `The initial password must be ${INITIAL_PASSWORD_MAX_LENGTH} characters or fewer.`,
      );
    }
    if (passwordCheck.reason === "too_short") {
      return invalid(
        "password",
        `The initial password must be at least ${INITIAL_PASSWORD_MIN_LENGTH} characters.`,
      );
    }
    return invalid("password", "Enter an initial password.");
  }

  return {
    ok: true,
    value: {
      companyName,
      organizationSlug,
      ownerName,
      ownerEmail,
      initialPassword: input.initialPassword as string,
    },
  };
}

function nothingCreatedFailure(
  ownerEmail: string,
  message: string,
): ClientProvisioningResult {
  return {
    status: "failed",
    message,
    recovery: {
      ownerEmail,
      ownerUserId: null,
      ownerAccountExists: null,
      accountCleanup: "not-needed",
      organizationExists: null,
    },
  };
}

function isDuplicateEmailError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const body = JSON.stringify(
    (error as { body?: unknown } | null)?.body ?? null,
  );
  return (
    message.includes("USER_ALREADY_EXISTS") ||
    body.includes("USER_ALREADY_EXISTS")
  );
}

/**
 * Handles a failed client-account creation call. A duplicate email is a
 * reportable conflict; any other failure is inspected (read-only) so the
 * caller gets an explicit state. The observed account is never deleted here:
 * after a failed call it cannot be proven that this operation created it.
 */
async function failAccountCreation(
  deps: ProvisioningDeps,
  ownerEmail: string,
  error: unknown,
): Promise<ClientProvisioningResult> {
  if (isDuplicateEmailError(error)) {
    return {
      status: "conflict",
      field: "owner_email",
      message: "An account already exists for this email address.",
    };
  }

  deps.log("Client account creation failed; no organization was created.");

  let observedUserId: string | null = null;
  let ownerAccountExists: boolean | null;
  try {
    observedUserId = await deps.findUserIdByEmail(ownerEmail);
    ownerAccountExists = observedUserId !== null;
  } catch {
    ownerAccountExists = null;
  }

  if (ownerAccountExists === true) {
    return {
      status: "failed",
      message:
        "The client account could not be created, but an account with this email exists. It was not modified; verify it before retrying.",
      recovery: {
        ownerEmail,
        ownerUserId: observedUserId,
        ownerAccountExists: true,
        accountCleanup: "not-attempted",
        organizationExists: null,
      },
    };
  }
  if (ownerAccountExists === false) {
    return {
      status: "failed",
      message:
        "The client account could not be created. Nothing was changed; you can retry.",
      recovery: {
        ownerEmail,
        ownerUserId: null,
        ownerAccountExists: false,
        accountCleanup: "not-needed",
        organizationExists: null,
      },
    };
  }
  return {
    status: "failed",
    message:
      "The client account could not be created and the resulting state could not be verified. Verify whether an account exists for this email before retrying.",
    recovery: {
      ownerEmail,
      ownerUserId: null,
      ownerAccountExists: null,
      accountCleanup: "not-attempted",
      organizationExists: null,
    },
  };
}

interface CleanupResult {
  accountCleanup: ProvisioningRecovery["accountCleanup"];
  accountExistsAfter: boolean | null;
}

/**
 * Removes the exact user row created by this operation and verifies the
 * outcome with a fresh read. The fresh read is the source of truth: only a
 * verified absence is reported as `"removed"`.
 */
async function cleanupCreatedAccount(
  deps: ProvisioningDeps,
  userId: string,
  email: string,
): Promise<CleanupResult> {
  let deletionFailed = false;
  try {
    await deps.deleteUser(userId);
  } catch {
    deletionFailed = true;
  }

  let stillExists: boolean | null;
  try {
    stillExists = (await deps.findUserIdByEmail(email)) !== null;
  } catch {
    stillExists = null;
  }

  if (stillExists === null) {
    return {
      accountCleanup: deletionFailed ? "not-removed" : "unverified",
      accountExistsAfter: null,
    };
  }
  return {
    accountCleanup: stillExists ? "not-removed" : "removed",
    accountExistsAfter: stillExists,
  };
}

function removalSentence(
  cleanup: CleanupResult,
  ownerEmail: string,
  ownerUserId: string,
): string {
  return cleanup.accountCleanup === "removed"
    ? "The client account was removed."
    : `The client account (${ownerEmail}, user ID ${ownerUserId}) could not be confirmed as removed; verify it before retrying.`;
}

/**
 * Decides the final result from the persisted state after the organization
 * creation attempt. This is the only place that reports success, and it does
 * so only when the organization and the client's `owner` membership have
 * both been read back and verified.
 */
async function finalizeProvisioning(
  deps: ProvisioningDeps,
  context: {
    organizationSlug: string;
    ownerEmail: string;
    ownerUserId: string;
  },
): Promise<ClientProvisioningResult> {
  const { organizationSlug, ownerEmail, ownerUserId } = context;

  let storedOrganization: StoredOrganization | null = null;
  let organizationLookupFailed = false;
  try {
    storedOrganization = await deps.findOrganizationBySlug(organizationSlug);
  } catch {
    organizationLookupFailed = true;
  }

  if (organizationLookupFailed) {
    deps.log(
      `Workspace state for link "${organizationSlug}" could not be determined; no cleanup was attempted.`,
    );
    return {
      status: "failed",
      message:
        "The client workspace state could not be verified and no automatic cleanup was attempted. " +
        `Verify the client account (${ownerEmail}) and the workspace link "${organizationSlug}" before retrying.`,
      recovery: {
        ownerEmail,
        ownerUserId,
        ownerAccountExists: true,
        accountCleanup: "not-attempted",
        organizationExists: null,
      },
    };
  }

  if (storedOrganization) {
    // An organization with this slug exists. The membership decides whether
    // the required end state is complete.
    let membershipRole: string | null = null;
    let membershipLookupFailed = false;
    try {
      const membership = await deps.findMembership({
        organizationId: storedOrganization.id,
        userId: ownerUserId,
      });
      membershipRole = membership?.role ?? null;
    } catch {
      membershipLookupFailed = true;
    }

    if (membershipLookupFailed) {
      deps.log(
        `Owner membership for organization ${storedOrganization.id} could not be verified; no cleanup was attempted.`,
      );
      return {
        status: "failed",
        message:
          "The client workspace could not be verified as complete and no automatic cleanup was attempted. " +
          `Verify the client account (${ownerEmail}) and the workspace link "${organizationSlug}" before retrying.`,
        recovery: {
          ownerEmail,
          ownerUserId,
          ownerAccountExists: true,
          accountCleanup: "not-attempted",
          organizationExists: true,
        },
      };
    }

    if (membershipRole === "owner") {
      // The required end state is fully verified: organization plus `owner`
      // membership. This holds even if an earlier call reported an error.
      deps.log(
        `Client workspace verified: organization ${storedOrganization.id}, link "${organizationSlug}".`,
      );
      return {
        status: "provisioned",
        organizationId: storedOrganization.id,
        organizationName: storedOrganization.name,
        organizationSlug,
        ownerUserId,
        ownerEmail,
        ownerMembershipRole: "owner",
      };
    }

    // The organization exists but the client is not its verified owner. The
    // organization is never modified or deleted; the account created by this
    // operation is removed so no unintended association remains.
    deps.log(
      `Owner membership for organization ${storedOrganization.id} is not "owner"; removing the account created by this operation.`,
    );
    const cleanup = await cleanupCreatedAccount(deps, ownerUserId, ownerEmail);
    return {
      status: "failed",
      message:
        `The client was not onboarded: the workspace link "${organizationSlug}" is registered to a workspace record ` +
        "without this client as its owner (the workspace record was not modified). " +
        removalSentence(cleanup, ownerEmail, ownerUserId),
      recovery: {
        ownerEmail,
        ownerUserId,
        ownerAccountExists: cleanup.accountExistsAfter,
        accountCleanup: cleanup.accountCleanup,
        organizationExists: true,
      },
    };
  }

  // No organization with the target slug exists: the organization was not
  // created, so remove the exact account created by this operation.
  deps.log(
    `No workspace record exists for link "${organizationSlug}"; removing the account created by this operation.`,
  );
  const cleanup = await cleanupCreatedAccount(deps, ownerUserId, ownerEmail);
  return {
    status: "failed",
    message:
      cleanup.accountCleanup === "removed"
        ? "Provisioning failed and the client account was removed. Nothing was changed; you can retry."
        : `Provisioning failed and the client account (${ownerEmail}, user ID ${ownerUserId}) could not be confirmed as removed. ` +
          "No workspace record was created. Verify, and remove the account if needed, before retrying.",
    recovery: {
      ownerEmail,
      ownerUserId,
      ownerAccountExists: cleanup.accountExistsAfter,
      accountCleanup: cleanup.accountCleanup,
      organizationExists: false,
    },
  };
}

/**
 * Provisions one client workspace for a verified platform operator.
 *
 * @param requestHeaders Headers of the request that triggered provisioning;
 *   the operator authorization gate is evaluated against them first.
 * @param input Raw boundary input; every field is validated here.
 * @param deps Injected server APIs; see `client-provisioning-server.ts` for
 *   the production wiring.
 */
export async function provisionClientWorkspace(
  requestHeaders: Headers,
  input: ProvisioningInput,
  deps: ProvisioningDeps,
): Promise<ClientProvisioningResult> {
  // 1. Authorization first. Unauthorized callers learn nothing and nothing is
  //    read or written on their behalf.
  let access: OperatorAccess;
  try {
    access = await deps.resolveOperatorAccess(requestHeaders);
  } catch {
    // Fail closed: when authorization cannot be verified, nothing happens.
    deps.log(
      "Client provisioning rejected: operator authorization could not be verified.",
    );
    return { status: "rejected" };
  }
  if (access.status !== "operator") {
    deps.log(
      "Client provisioning rejected: the caller is not an authorized platform operator.",
    );
    return { status: "rejected" };
  }

  // 2. Boundary validation. No database or API is touched for invalid input.
  const validated = validateProvisioningInput(input);
  if (!validated.ok) {
    return {
      status: "invalid_input",
      field: validated.field,
      message: validated.message,
    };
  }
  const { companyName, organizationSlug, ownerName, ownerEmail, initialPassword } =
    validated.value;

  // 3. Read-only conflict pre-checks so the common conflicts are reported
  //    before anything is created. Races are still possible; the create calls
  //    remain authoritative and are handled below.
  try {
    const existingUserId = await deps.findUserIdByEmail(ownerEmail);
    if (existingUserId) {
      return {
        status: "conflict",
        field: "owner_email",
        message: "An account already exists for this email address.",
      };
    }
    const conflictingOrganization =
      await deps.findOrganizationBySlug(organizationSlug);
    if (conflictingOrganization) {
      return {
        status: "conflict",
        field: "slug",
        message: `The workspace link "${organizationSlug}" is already in use. Choose a different alternative slug.`,
      };
    }
  } catch {
    deps.log(
      "Client provisioning stopped during pre-flight checks; nothing was created.",
    );
    return nothingCreatedFailure(
      ownerEmail,
      "The provisioning request could not be completed and nothing was created. You can retry.",
    );
  }

  // 4. Create the client owner account (default `user` role; no role is ever
  //    accepted from this flow).
  let ownerUserId: string | null = null;
  try {
    const created = await deps.createClientUser({
      email: ownerEmail,
      name: ownerName,
      password: initialPassword,
    });
    ownerUserId =
      typeof created?.id === "string" && created.id !== "" ? created.id : null;
  } catch (error) {
    return await failAccountCreation(deps, ownerEmail, error);
  }
  if (ownerUserId === null) {
    return await failAccountCreation(deps, ownerEmail, null);
  }
  deps.log(`Client account created (user ID ${ownerUserId}).`);

  // 5. Create the organization for that exact account. Whether this call
  //    reports success or not, the outcome is decided by the persisted state
  //    in step 6, never by the call's return value alone.
  try {
    await deps.createOrganizationForOwner({
      name: companyName,
      slug: organizationSlug,
      ownerUserId,
    });
  } catch {
    deps.log(
      `Workspace creation call failed for link "${organizationSlug}"; verifying the resulting state.`,
    );
  }

  // 6. Verify the persisted organization and the `owner` membership, and
  //    report success only when both are confirmed.
  return await finalizeProvisioning(deps, {
    organizationSlug,
    ownerEmail,
    ownerUserId,
  });
}
