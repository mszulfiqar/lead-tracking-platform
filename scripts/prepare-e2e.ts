#!/usr/bin/env tsx
/**
 * Prepares the dedicated TEST database for the Playwright acceptance suite.
 * Runs before `playwright test` (see the `test:e2e` script); the Playwright
 * configuration reads the runtime state it writes to seed
 * `PLATFORM_OPERATOR_USER_IDS` for the test server.
 *
 * Safety properties:
 * - Uses only the validated `TEST_DATABASE_URL`; never falls back to
 *   `DATABASE_URL` and never touches a development or production database.
 * - Applies the committed Drizzle migrations to the test database.
 * - Replaces the E2E accounts with fresh ones, using random run-scoped
 *   passwords that are written only to the git-ignored runtime state file.
 *   No credentials live in source control, and passwords are never logged.
 */
import crypto from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import {
  E2E_MEMBER_EMAIL,
  E2E_OPERATOR_EMAIL,
  writeE2eState,
} from "../tests/e2e-support/e2e-state";
import { cleanupE2eRunData } from "../tests/e2e-support/e2e-cleanup";
import { migrateTestDatabase } from "../tests/helpers/migrate-test-database";
import {
  getTestDatabaseUrl,
  loadLocalEnvFiles,
} from "../tests/helpers/test-environment";

function generatePassword(): string {
  // 24 random bytes -> 32 URL-safe characters, inside the 8-128 policy.
  return crypto.randomBytes(24).toString("base64url");
}

async function main(): Promise<void> {
  loadLocalEnvFiles();

  // 1. Validate TEST_DATABASE_URL and migrate the test database.
  const { database } = await migrateTestDatabase();

  // 1b. Purge leftovers recorded by a previous run that never reached its
  //     Playwright global teardown (for example, an aborted run). Only the
  //     exact emails and organization slugs recorded by that run are removed.
  const leftover = await cleanupE2eRunData();
  if (leftover) {
    console.log(
      `[e2e:prepare] Removed ${leftover.deletedUsers} leftover user(s) and ` +
        `${leftover.deletedOrganizations} leftover organization(s) from a previous run.`,
    );
  }

  // 2. Point application modules at the validated test database. The modules
  //    below read DATABASE_URL at import time, so it must be set first.
  process.env.DATABASE_URL = getTestDatabaseUrl();

  const [{ db, pool }, { auth }, { user }] = await Promise.all([
    import("../src/db"),
    import("../src/lib/auth"),
    import("../src/db/auth-schema"),
  ]);

  try {
    // 3. Replace previous E2E accounts (cascade removes their sessions and
    //    credential accounts) so every run starts from a known state.
    await db
      .delete(user)
      .where(inArray(user.email, [E2E_OPERATOR_EMAIL, E2E_MEMBER_EMAIL]));

    const operatorPassword = generatePassword();
    const memberPassword = generatePassword();

    // 4. Create the accounts through Better Auth's supported server-side API
    //    with the default "user" role. Platform-operator status is granted
    //    only through PLATFORM_OPERATOR_USER_IDS, never through a role.
    const operator = await auth.api.createUser({
      body: {
        email: E2E_OPERATOR_EMAIL,
        name: "E2E Platform Operator",
        password: operatorPassword,
      },
    });
    const member = await auth.api.createUser({
      body: {
        email: E2E_MEMBER_EMAIL,
        name: "E2E Client Member",
        password: memberPassword,
      },
    });

    // Sanity check: both users must exist and differ.
    const created = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(
        and(
          inArray(user.email, [E2E_OPERATOR_EMAIL, E2E_MEMBER_EMAIL]),
          eq(user.role, "user"),
        ),
      );
    if (created.length !== 2 || operator.user.id === member.user.id) {
      throw new Error(
        "E2E account preparation did not produce two distinct client-role users. Aborting.",
      );
    }

    // 5. Persist runtime state (git-ignored) for the Playwright runner.
    writeE2eState({
      database,
      operatorUserId: operator.user.id,
      operatorEmail: E2E_OPERATOR_EMAIL,
      operatorPassword,
      memberUserId: member.user.id,
      memberEmail: E2E_MEMBER_EMAIL,
      memberPassword,
    });

    console.log(`[e2e:prepare] Test database ready: ${database}`);
    console.log(`[e2e:prepare] Operator account prepared (user id ${operator.user.id}).`);
    console.log("[e2e:prepare] Client-role account prepared.");
    console.log(
      "[e2e:prepare] Wrote git-ignored runtime state for the Playwright run (passwords are not logged).",
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    `[e2e:prepare] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
