/**
 * Applies committed Drizzle migrations to the dedicated TEST database.
 *
 * Used by the Vitest global setup and the Playwright preparation script so
 * every automated test run starts against the current schema. The target URL
 * is validated by `test-environment.ts` (must be `TEST_DATABASE_URL`, must end
 * with `_test`, must be local unless explicitly overridden, and never the same
 * database as `DATABASE_URL`); the live connection is additionally verified
 * with `current_database()` before any migration runs.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { getTestDatabaseUrl, testDatabaseIdentity } from "./test-environment";

export async function migrateTestDatabase(): Promise<{ database: string }> {
  const url = getTestDatabaseUrl();
  const pool = new Pool({
    connectionString: url,
    application_name: "lead-tracking-platform-test-migrate",
    max: 1,
    connectionTimeoutMillis: 10_000,
  });

  try {
    const { rows } = await pool.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    const actual = rows[0]?.database_name;
    const expected = testDatabaseIdentity(url);

    if (actual !== expected.database) {
      throw new Error(
        `Refusing to migrate: TEST_DATABASE_URL targets "${expected.database}" but the server reports "${actual}".`,
      );
    }
    if (!actual.toLowerCase().endsWith("_test")) {
      throw new Error(
        `Refusing to migrate database "${actual}": the name must end with "_test".`,
      );
    }

    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    return { database: actual };
  } finally {
    await pool.end();
  }
}
