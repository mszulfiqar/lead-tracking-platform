/**
 * Dedicated test database access for integration tests.
 *
 * Connects only to the validated `TEST_DATABASE_URL` (see `test-environment.ts`).
 * Integration tests must stay read-only or operate exclusively on data they
 * create in the test database; they must never touch production data.
 */
import { Pool } from "pg";
import { getTestDatabaseUrl, testDatabaseIdentity } from "./test-environment";

export function createTestPool(): Pool {
  return new Pool({
    connectionString: getTestDatabaseUrl(),
    application_name: "lead-tracking-platform-tests",
    max: 4,
    connectionTimeoutMillis: 10_000,
  });
}

export async function verifyTestDatabaseConnection(
  pool: Pool,
): Promise<{ databaseName: string; serverVersion: string }> {
  const { rows } = await pool.query<{ database_name: string; server_version: string }>(
    "SELECT current_database() AS database_name, version() AS server_version",
  );
  const row = rows[0];
  if (!row) throw new Error("Test database verification query returned no rows.");

  const expected = testDatabaseIdentity();
  if (row.database_name !== expected.database) {
    throw new Error(
      `Test database mismatch: TEST_DATABASE_URL targets "${expected.database}" ` +
        `but the server reports "${row.database_name}".`,
    );
  }
  if (!row.database_name.toLowerCase().endsWith("_test")) {
    throw new Error(`Refusing to use database "${row.database_name}": the name must end with "_test".`);
  }
  return { databaseName: row.database_name, serverVersion: row.server_version };
}
