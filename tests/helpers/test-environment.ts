/**
 * Environment and safety helpers for automated tests.
 *
 * Automated tests must only ever run against the dedicated test database
 * (`TEST_DATABASE_URL`). This module:
 *
 * 1. Loads ignored local environment files so `TEST_DATABASE_URL` is available
 *    (real `process.env` values always win over file values).
 * 2. Validates `TEST_DATABASE_URL` and refuses unsafe configurations:
 *    - missing value -> fail (never falls back to `DATABASE_URL`),
 *    - non-PostgreSQL URL,
 *    - database name that does not end with `_test`,
 *    - non-local hosts unless `ALLOW_REMOTE_TEST_DATABASE=true`,
 *    - the same database that `DATABASE_URL` already points at.
 * 3. Repoints `process.env.DATABASE_URL` at the test database for the test
 *    process so any application code under test that reads `DATABASE_URL`
 *    still uses the test database. The redirect is recorded in
 *    `TEST_DATABASE_URL_REDIRECTED` so child processes (for example Playwright
 *    workers that re-load the config) do not mistake the redirected value for
 *    a duplicated configuration.
 *
 * Keep the loading/validation rules in sync with `scripts/create-test-database.mjs`.
 */
import fs from "node:fs";
import path from "node:path";

const ENV_FILES = [".env.test.local", ".env.local"] as const;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface TestDatabaseChecks {
  /**
   * The `DATABASE_URL` value to compare against. Defaults to the value captured
   * before the test environment redirected `DATABASE_URL` to the test database.
   * Pass `null` to skip the comparison.
   */
  databaseUrl?: string | null;
  /** Allow non-local test database hosts. Defaults to `ALLOW_REMOTE_TEST_DATABASE === "true"`. */
  allowRemote?: boolean;
}

export interface TestDatabaseIdentity {
  host: string;
  port: number;
  database: string;
}

let originalDatabaseUrl: string | undefined;
let environmentPrepared = false;

/** Loads `.env.test.local` (preferred) and `.env.local`, without overriding real environment variables. */
export function loadLocalEnvFiles(cwd: string = process.cwd()): void {
  for (const fileName of ENV_FILES) {
    const filePath = path.join(cwd, fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      process.loadEnvFile(filePath);
    } catch {
      // An unreadable file will surface as a missing TEST_DATABASE_URL below.
    }
  }
}

export function assertSafeTestDatabaseUrl(
  rawUrl: string | undefined,
  checks: TestDatabaseChecks = {},
): URL {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Automated tests never fall back to DATABASE_URL; " +
        "configure a dedicated test database in .env.test.local or .env.local (see .env.example).",
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid connection URL.");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(
      `TEST_DATABASE_URL must be a PostgreSQL URL (received protocol "${url.protocol}").`,
    );
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) {
    throw new Error("TEST_DATABASE_URL does not include a database name.");
  }
  if (!database.toLowerCase().endsWith("_test")) {
    throw new Error(
      `Refusing to use "${database}" as a test database: its name must end with "_test" ` +
        "so a development or production database can never be reused by accident.",
    );
  }

  const allowRemote = checks.allowRemote ?? process.env.ALLOW_REMOTE_TEST_DATABASE === "true";
  if (!LOCAL_HOSTNAMES.has(url.hostname.toLowerCase()) && !allowRemote) {
    throw new Error(
      `Refusing to use non-local test database host "${url.hostname}". ` +
        "Set ALLOW_REMOTE_TEST_DATABASE=true only for an intentional, non-production test database.",
    );
  }

  const comparisonBase =
    checks.databaseUrl === undefined
      ? (originalDatabaseUrl ?? (isDatabaseUrlRedirected() ? undefined : process.env.DATABASE_URL))
      : checks.databaseUrl;
  if (comparisonBase) {
    let baseUrl: URL | undefined;
    try {
      baseUrl = new URL(comparisonBase);
    } catch {
      baseUrl = undefined;
    }
    if (baseUrl && sameDatabase(baseUrl, url)) {
      throw new Error(
        "TEST_DATABASE_URL points at the same database as DATABASE_URL. " +
          "Automated tests require a separate test database.",
      );
    }
  }

  return url;
}

export function getTestDatabaseUrl(checks: TestDatabaseChecks = {}): string {
  const trimmed = process.env.TEST_DATABASE_URL?.trim() ?? "";
  assertSafeTestDatabaseUrl(trimmed, checks);
  return trimmed;
}

export function testDatabaseIdentity(rawUrl: string = getTestDatabaseUrl()): TestDatabaseIdentity {
  const url = new URL(rawUrl);
  return {
    host: url.hostname.toLowerCase(),
    port: url.port ? Number.parseInt(url.port, 10) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

/**
 * Points `process.env.DATABASE_URL` at the validated test database for the
 * current process and everything it spawns, and records that the redirect
 * happened so later config reloads in child processes skip the
 * "same database as DATABASE_URL" check (the current value no longer shows
 * the original development value).
 */
export function redirectDatabaseUrlToTestDatabase(): string {
  const testDatabaseUrl = getTestDatabaseUrl();
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.TEST_DATABASE_URL_REDIRECTED = "true";
  return testDatabaseUrl;
}

/**
 * Prepares the test process before any test runs:
 * - loads local environment files,
 * - fails fast when TEST_DATABASE_URL is missing or unsafe,
 * - points DATABASE_URL at the test database for this process only.
 */
export function setupTestEnvironment(): void {
  if (environmentPrepared) return;
  loadLocalEnvFiles();
  originalDatabaseUrl = process.env.DATABASE_URL;
  redirectDatabaseUrlToTestDatabase();
  environmentPrepared = true;
}

function isDatabaseUrlRedirected(): boolean {
  return process.env.TEST_DATABASE_URL_REDIRECTED === "true";
}

function sameDatabase(a: URL, b: URL): boolean {
  const port = (url: URL) => (url.port ? url.port : "5432");
  const database = (url: URL) => decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
  return (
    a.hostname.toLowerCase() === b.hostname.toLowerCase() &&
    port(a) === port(b) &&
    database(a) === database(b)
  );
}
