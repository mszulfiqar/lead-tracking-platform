/**
 * One-time operator bootstrap flow (logic only; the CLI wiring lives in
 * `scripts/bootstrap-operator.ts`).
 *
 * The flow is deliberately dependency-injected so every guardrail can be
 * exercised by automated tests without a database:
 *
 * 1. The target database identity is verified (live query) before anything
 *    else, and again before the user is created.
 * 2. Email, name, and password are collected through caller-provided prompts.
 *    The password is validated against the initial-password policy (8–128
 *    characters) and never logged.
 * 3. If the email already exists, nothing is changed: the existing user ID is
 *    returned so the operator can be added to the allowlist (fail safe /
 *    idempotent).
 * 4. Otherwise the account is created through Better Auth's supported
 *    server-side user-creation API with the default `"user"` role. Platform
 *    operator privileges come exclusively from the
 *    `PLATFORM_OPERATOR_USER_IDS` allowlist, so this flow never assigns the
 *    built-in admin role.
 */
import type { GuardedDatabaseTarget } from "./database-safety";
import { DatabaseSafetyError } from "./database-safety";
import { validateInitialPassword } from "./password-policy";

export class BootstrapInputError extends Error {}

export interface BootstrapOperatorDeps {
  target: GuardedDatabaseTarget;
  prompts: {
    email(): Promise<string>;
    name(): Promise<string>;
    /** Prompts for the password without echoing it. */
    password(): Promise<string>;
    /** Prompts for the password a second time without echoing it. */
    confirmPassword(): Promise<string>;
  };
  verifyDatabaseIdentity(
    target: GuardedDatabaseTarget,
  ): Promise<{ databaseName: string; serverVersion: string }>;
  findUserIdByEmail(email: string): Promise<string | null>;
  createUser(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<{ id: string }>;
  /** Receives progress messages only. Never pass passwords or secrets. */
  log(message: string): void;
}

export type BootstrapOperatorResult =
  | { status: "created"; userId: string; email: string }
  | { status: "existing"; userId: string; email: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeOperatorEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function bootstrapOperator(
  deps: BootstrapOperatorDeps,
): Promise<BootstrapOperatorResult> {
  const identity = await deps.verifyDatabaseIdentity(deps.target);
  if (identity.databaseName !== deps.target.database) {
    throw new DatabaseSafetyError(
      `Database identity mismatch: configured "${deps.target.database}" but the server reports "${identity.databaseName}". Nothing was changed.`,
    );
  }
  deps.log(`Verified target database: ${deps.target.summary} (${identity.serverVersion}).`);

  const email = normalizeOperatorEmail(await deps.prompts.email());
  if (!EMAIL_PATTERN.test(email)) {
    throw new BootstrapInputError("Enter a valid operator email address.");
  }

  const rawName = (await deps.prompts.name()).trim();
  const name = rawName === "" ? "Platform Operator" : rawName;

  const password = await deps.prompts.password();
  const confirmation = await deps.prompts.confirmPassword();
  if (password !== confirmation) {
    throw new BootstrapInputError("The passwords did not match. Nothing was changed.");
  }
  const passwordCheck = validateInitialPassword(password);
  if (!passwordCheck.ok) {
    throw new BootstrapInputError(
      "The password must be between 8 and 128 characters. Nothing was changed.",
    );
  }

  const existingUserId = await deps.findUserIdByEmail(email);
  if (existingUserId) {
    return { status: "existing", userId: existingUserId, email };
  }

  const created = await deps.createUser({ email, name, password });
  if (!created?.id) {
    throw new Error(
      "Account creation did not return a user ID. The account state is unknown; verify the database before retrying.",
    );
  }
  return { status: "created", userId: created.id, email };
}
