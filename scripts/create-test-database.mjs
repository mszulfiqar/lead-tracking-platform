#!/usr/bin/env node
/**
 * Creates the dedicated local test database if it does not exist yet.
 *
 * Safety rules enforced here:
 * - Only TEST_DATABASE_URL is used; DATABASE_URL is never read or connected to.
 * - The target server must be local (localhost / 127.0.0.1 / ::1).
 * - The target database name must be a simple identifier ending with "_test".
 * - The script is idempotent: it verifies and exits when the database exists.
 *
 * Usage: npm run db:create-test
 *
 * Keep the loading/validation rules in sync with tests/helpers/test-environment.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const ENV_FILES = [".env.test.local", ".env.local"];
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function fail(message) {
  console.error(`[db:create-test] ${message}`);
  process.exit(1);
}

function loadEnvFiles() {
  for (const fileName of ENV_FILES) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      process.loadEnvFile(filePath);
    } catch {
      // Ignore unreadable files; a missing TEST_DATABASE_URL is reported next.
    }
  }
}

function parseTestDatabaseUrl() {
  const raw = process.env.TEST_DATABASE_URL?.trim();
  if (!raw) {
    fail("TEST_DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("TEST_DATABASE_URL is not a valid connection URL.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    fail("TEST_DATABASE_URL must be a PostgreSQL connection URL.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) {
    fail("TEST_DATABASE_URL does not include a database name.");
  }
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    fail(`Test database name "${database}" contains unsupported characters.`);
  }
  if (!database.toLowerCase().endsWith("_test")) {
    fail(`Refusing to create "${database}": the test database name must end with "_test".`);
  }
  if (!LOCAL_HOSTNAMES.has(url.hostname.toLowerCase())) {
    fail(`Refusing to create a database on non-local host "${url.hostname}".`);
  }

  return { url, database, summary: `${url.hostname}:${url.port || "5432"}/${database}` };
}

/** Returns a connected client, or null when the database does not exist (3D000). */
async function tryConnect(connectionUrl) {
  const client = new Client({
    connectionString: connectionUrl,
    application_name: "lead-tracking-platform-db-setup",
  });
  try {
    await client.connect();
    return client;
  } catch (error) {
    if (error?.code === "3D000") return null;
    throw error;
  }
}

async function main() {
  loadEnvFiles();
  const target = parseTestDatabaseUrl();

  // 1. If the test database already exists, verify it and stop.
  const existing = await tryConnect(target.url.toString());
  if (existing) {
    const { rows } = await existing.query("SELECT version() AS server_version");
    await existing.end();
    console.log(`[db:create-test] Test database already exists and is reachable: ${target.summary}`);
    console.log(`[db:create-test] ${rows[0]?.server_version ?? "PostgreSQL"}`);
    return;
  }

  // 2. Database missing: create it via the same local server's maintenance database.
  const maintenanceUrl = new URL(target.url.toString());
  maintenanceUrl.pathname = "/postgres";
  const maintenance = await tryConnect(maintenanceUrl.toString());
  if (!maintenance) {
    fail('Could not connect to the local server\'s maintenance database "postgres".');
  }
  try {
    await maintenance.query(`CREATE DATABASE "${target.database}"`);
  } finally {
    await maintenance.end();
  }

  // 3. Verify by connecting to the newly created database.
  const created = await tryConnect(target.url.toString());
  if (!created) {
    fail("Created the test database but could not connect to it afterwards.");
  }
  const { rows } = await created.query(
    "SELECT current_database() AS database_name, version() AS server_version",
  );
  await created.end();
  if (rows[0]?.database_name !== target.database) {
    fail(`Unexpected database after creation: "${rows[0]?.database_name}".`);
  }
  console.log(`[db:create-test] Created test database: ${target.summary}`);
  console.log(`[db:create-test] ${rows[0]?.server_version ?? "PostgreSQL"}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
