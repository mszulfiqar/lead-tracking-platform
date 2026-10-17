import { afterAll, describe, expect, it } from "vitest";
import { createTestPool, verifyTestDatabaseConnection } from "../helpers/test-database";
import { testDatabaseIdentity } from "../helpers/test-environment";

// Read-only connectivity checks against the dedicated test database. These are
// safe to run at any time: they never modify data or schema.
describe("test database connectivity", () => {
  const pool = createTestPool();

  afterAll(async () => {
    await pool.end();
  });

  it("connects to the dedicated local test database identified by TEST_DATABASE_URL", async () => {
    const identity = testDatabaseIdentity();
    const info = await verifyTestDatabaseConnection(pool);

    expect(info.databaseName).toBe(identity.database);
    expect(info.databaseName).toMatch(/_test$/i);
    expect(info.serverVersion).toMatch(/PostgreSQL/i);
  });

  it("answers a trivial read-only query", async () => {
    const { rows } = await pool.query<{ ok: number }>("SELECT 1 AS ok");
    expect(rows[0]?.ok).toBe(1);
  });
});
