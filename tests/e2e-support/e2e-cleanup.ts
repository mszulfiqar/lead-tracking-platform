/**
 * Exact cleanup of data created by Playwright acceptance runs.
 *
 * The suite provisions real users and organizations in the dedicated test
 * database. This module removes them again using only the exact identifiers
 * recorded by `e2e-artifacts.ts` (emails and organization slugs that include a
 * per-run random suffix). It never deletes by pattern, role, or any shared
 * attribute, so records that were not created by a recorded E2E run are never
 * touched.
 *
 * Safety properties:
 * - Connects only to the validated `TEST_DATABASE_URL` (must end with
 *   `_test`, must be local unless explicitly overridden, never the same
 *   database as `DATABASE_URL`).
 * - Verifies `current_database()` before deleting anything.
 * - Deletes users and organizations only by exact recorded identifier.
 * - Verifies the deletions with fresh reads; artifact files are removed only
 *   after the recorded data is confirmed gone, so an interrupted cleanup can
 *   be retried by the next run.
 */
import { Pool } from "pg";

import {
  getTestDatabaseUrl,
  loadLocalEnvFiles,
  testDatabaseIdentity,
} from "../helpers/test-environment";
import {
  readE2eRunArtifacts,
  removeE2eArtifactTempFiles,
  removeE2eRunArtifactFile,
} from "./e2e-artifacts";

export interface E2eCleanupReport {
  database: string;
  deletedUsers: number;
  deletedOrganizations: number;
  removedArtifactFiles: number;
}

/**
 * Removes exactly the accounts and organizations recorded by previous E2E
 * runs and then removes their artifact files. Returns `null` when no run
 * recorded anything (nothing to clean up).
 */
export async function cleanupE2eRunData(): Promise<E2eCleanupReport | null> {
  loadLocalEnvFiles();

  const artifacts = readE2eRunArtifacts();
  if (artifacts.length === 0) {
    removeE2eArtifactTempFiles();
    return null;
  }

  const url = getTestDatabaseUrl();
  const pool = new Pool({
    connectionString: url,
    application_name: "lead-tracking-platform-e2e-cleanup",
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    const { rows } = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    const actual = rows[0]?.database_name ?? "";
    const expected = testDatabaseIdentity(url);
    if (actual !== expected.database || !actual.toLowerCase().endsWith("_test")) {
      throw new Error(
        `Refusing to clean up: connected to "${actual}" but expected the dedicated test database "${expected.database}".`,
      );
    }

    const emails = [
      ...new Set(artifacts.flatMap((artifact) => artifact.userEmails)),
    ];
    const slugs = [
      ...new Set(artifacts.flatMap((artifact) => artifact.organizationSlugs)),
    ];

    let deletedUsers = 0;
    for (const email of emails) {
      // Exact match only. Related sessions, credential accounts, and members
      // cascade with the user row.
      const result = await pool.query('DELETE FROM "user" WHERE email = $1', [
        email,
      ]);
      deletedUsers += result.rowCount ?? 0;
    }

    let deletedOrganizations = 0;
    for (const slug of slugs) {
      // Exact match only. Memberships and invitations cascade with the row.
      const result = await pool.query(
        'DELETE FROM "organization" WHERE slug = $1',
        [slug],
      );
      deletedOrganizations += result.rowCount ?? 0;
    }

    // Only a verified absence allows the artifact files to be discarded.
    if (emails.length > 0) {
      const { rows: remaining } = await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM "user" WHERE email = ANY($1::text[])',
        [emails],
      );
      if ((remaining[0]?.count ?? 0) !== 0) {
        throw new Error(
          "E2E cleanup could not verify removal of every recorded test account; artifact files were kept for the next run.",
        );
      }
    }
    if (slugs.length > 0) {
      const { rows: remaining } = await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM "organization" WHERE slug = ANY($1::text[])',
        [slugs],
      );
      if ((remaining[0]?.count ?? 0) !== 0) {
        throw new Error(
          "E2E cleanup could not verify removal of every recorded test organization; artifact files were kept for the next run.",
        );
      }
    }

    removeE2eArtifactTempFiles();
    for (const artifact of artifacts) {
      removeE2eRunArtifactFile(artifact.filePath);
    }

    return {
      database: actual,
      deletedUsers,
      deletedOrganizations,
      removedArtifactFiles: artifacts.length,
    };
  } finally {
    await pool.end();
  }
}
