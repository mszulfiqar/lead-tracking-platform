/**
 * Environment and database-target guards shared by privileged server scripts
 * (development migrations and the one-time platform-operator bootstrap).
 *
 * These guards are pure functions so they can be unit tested without touching
 * a database. They fail closed: any missing, ambiguous, or remote
 * configuration is refused before a connection is opened.
 *
 * Hosted databases (for example a Neon production branch) are never a valid
 * target for these scripts, and the dedicated test database is migrated by the
 * automated test tooling instead.
 */
export class DatabaseSafetyError extends Error {}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface GuardedDatabaseTarget {
  url: URL;
  host: string;
  port: string;
  database: string;
  /** Safe-to-log description of the target (host, port, database name only). */
  summary: string;
}

function parsePostgresUrl(rawUrl: string | undefined, envName: string): URL {
  const trimmed = rawUrl?.trim();
  if (!trimmed) {
    throw new DatabaseSafetyError(
      `${envName} is not set. Configure the local development database (see .env.example).`,
    );
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new DatabaseSafetyError(`${envName} is not a valid connection URL.`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new DatabaseSafetyError(`${envName} must be a PostgreSQL connection URL.`);
  }
  if (!decodeURIComponent(url.pathname.replace(/^\//, ""))) {
    throw new DatabaseSafetyError(`${envName} does not include a database name.`);
  }
  return url;
}

/**
 * Validates that the environment points at a local, non-test PostgreSQL
 * database suitable for privileged development scripts.
 */
export function assertLocalDevelopmentDatabaseTarget(
  env: Record<string, string | undefined>,
  envName = "DATABASE_URL",
): GuardedDatabaseTarget {
  const url = parsePostgresUrl(env[envName], envName);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (database.toLowerCase().endsWith("_test")) {
    throw new DatabaseSafetyError(
      `Refusing to use "${database}": automated test databases are managed by the test tooling, not by this script.`,
    );
  }

  const host = url.hostname.toLowerCase();
  if (!LOCAL_HOSTNAMES.has(host)) {
    throw new DatabaseSafetyError(
      `Refusing to use non-local host "${url.hostname}". This script only ever targets a local development database; ` +
        "hosted databases such as Neon production are never touched.",
    );
  }

  return {
    url,
    host,
    port: url.port || "5432",
    database,
    summary: `${url.hostname}:${url.port || "5432"}/${database}`,
  };
}

/**
 * Validates the environment for the one-time operator bootstrap. In addition
 * to the local-database rules, running with `NODE_ENV=production` is refused.
 */
export function assertSafeBootstrapTarget(
  env: Record<string, string | undefined>,
): GuardedDatabaseTarget {
  if (env.NODE_ENV === "production") {
    throw new DatabaseSafetyError(
      "Refusing to run the operator bootstrap with NODE_ENV=production.",
    );
  }
  return assertLocalDevelopmentDatabaseTarget(env);
}
