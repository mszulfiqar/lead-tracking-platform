#!/usr/bin/env tsx
/**
 * Applies committed Drizzle migrations (`./drizzle`) to the LOCAL development
 * database.
 *
 * Safety rules (see `src/lib/database-safety.ts`):
 * - Reads `DATABASE_URL` only; never falls back to `TEST_DATABASE_URL`.
 * - Refuses remote hosts, so a hosted production branch (for example Neon)
 *   can never be migrated by accident.
 * - Refuses databases whose name ends with `_test`.
 * - Verifies `current_database()` before applying any migration and prints the
 *   verified target so the operator can confirm it.
 *
 * Usage: npm run db:migrate
 */
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { assertLocalDevelopmentDatabaseTarget } from "../src/lib/database-safety";

// drizzle-kit and this script do not load Next.js env files by default; load
// them here so `npm run db:migrate` uses the same local configuration as the
// application. Real environment variables always win.
for (const fileName of [".env.local", ".env"]) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) continue;
  try {
    process.loadEnvFile(filePath);
  } catch {
    // An unreadable file surfaces as a missing DATABASE_URL below.
  }
}

async function main(): Promise<void> {
  const target = assertLocalDevelopmentDatabaseTarget(process.env);

  const client = new Client({
    connectionString: target.url.toString(),
    application_name: "lead-tracking-platform-db-migrate",
  });
  await client.connect();
  try {
    const { rows } = await client.query<{
      database_name: string;
      server_version: string;
    }>("SELECT current_database() AS database_name, version() AS server_version");
    const actual = rows[0]?.database_name;
    if (actual !== target.database) {
      throw new Error(
        `Database identity mismatch: DATABASE_URL targets "${target.database}" but the server reports "${actual}". Nothing was migrated.`,
      );
    }
    if (!actual || actual.toLowerCase().endsWith("_test")) {
      throw new Error("Refusing to migrate: target is not a safe local development database.");
    }

    console.log(`[db:migrate] Target verified: ${target.summary}`);
    console.log(`[db:migrate] ${rows[0]?.server_version ?? "PostgreSQL"}`);

    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log(`[db:migrate] Applied committed Drizzle migrations from ./drizzle to "${actual}".`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[db:migrate] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
