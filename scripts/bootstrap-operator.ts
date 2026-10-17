#!/usr/bin/env tsx
/**
 * One-time platform-operator bootstrap (server-only, local development only).
 *
 * Creates the first platform-operator account in the LOCAL development
 * database through Better Auth's supported server-side user-creation API, then
 * prints the generated user ID. The operator's privileges come exclusively
 * from adding that user ID to `PLATFORM_OPERATOR_USER_IDS`; this script never
 * assigns the built-in `admin` role and never exposes an HTTP endpoint.
 *
 * Safety properties:
 * - `DATABASE_URL` is the only source; there is no fallback to
 *   `TEST_DATABASE_URL`.
 * - Remote hosts (for example Neon production), `_test` databases, and
 *   `NODE_ENV=production` are refused before any connection or prompt.
 * - The live `current_database()` identity is verified before anything is
 *   written.
 * - The password is entered interactively without echoing, validated against
 *   the 8–128 character policy, and never logged, stored in files, passed as
 *   a command-line argument, or sent anywhere except Better Auth's password
 *   hashing.
 * - Re-running is safe: if the email already exists, nothing is changed and
 *   the existing user ID is printed.
 *
 * Usage: npm run operator:bootstrap
 */
import fs from "node:fs";
import path from "node:path";

import {
  assertSafeBootstrapTarget,
  DatabaseSafetyError,
} from "../src/lib/database-safety";
import {
  bootstrapOperator,
  BootstrapInputError,
} from "../src/lib/operator-bootstrap";

for (const fileName of [".env.local", ".env"]) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) continue;
  try {
    process.loadEnvFile(filePath);
  } catch {
    // An unreadable file surfaces as a missing DATABASE_URL below.
  }
}

/**
 * Reads one line from an interactive terminal. Passwords are read with
 * `hidden: true` so nothing is echoed; non-interactive input (pipes, files,
 * command substitution) is refused so secrets cannot be captured or replayed
 * from logs.
 */
function readInteractiveLine(
  question: string,
  options: { hidden?: boolean } = {},
): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(
      new Error(
        "The operator bootstrap requires an interactive terminal. Passwords are never read from pipes, files, or command-line arguments.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const finish = (result: string | Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    const onData = (chunk: string) => {
      // Ignore terminal escape sequences (arrow keys, etc.) entirely.
      if (chunk.includes("\u001b")) return;
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish(value);
          return;
        }
        if (char === "\u0003") {
          finish(new Error("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            if (!options.hidden) stdout.write("\b \b");
          }
          continue;
        }
        if (char >= " ") {
          value += char;
          if (!options.hidden) stdout.write(char);
        }
      }
    };

    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const target = assertSafeBootstrapTarget(process.env);
  console.log(`[operator:bootstrap] Target database: ${target.summary}`);

  // Import application modules only after the environment is loaded and the
  // target is validated, so a misconfigured environment fails closed first.
  const [{ db, pool }, { user }, { auth }, { eq }] = await Promise.all([
    import("../src/db"),
    import("../src/db/auth-schema"),
    import("../src/lib/auth"),
    import("drizzle-orm"),
  ]);

  try {
    const result = await bootstrapOperator({
      target,
      prompts: {
        email: () => readInteractiveLine("Operator email: "),
        name: () => readInteractiveLine('Operator name (default "Platform Operator"): '),
        password: () =>
          readInteractiveLine("Password (8-128 characters, not echoed): ", {
            hidden: true,
          }),
        confirmPassword: () =>
          readInteractiveLine("Confirm password: ", { hidden: true }),
      },
      verifyDatabaseIdentity: async () => {
        const { rows } = await pool.query<{
          database_name: string;
          server_version: string;
        }>(
          "SELECT current_database() AS database_name, version() AS server_version",
        );
        const row = rows[0];
        if (!row) throw new Error("Database identity query returned no rows.");
        return {
          databaseName: row.database_name,
          serverVersion: row.server_version,
        };
      },
      findUserIdByEmail: async (email) => {
        const rows = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, email))
          .limit(1);
        return rows[0]?.id ?? null;
      },
      createUser: async ({ email, name, password }) => {
        // Better Auth hashes the password with its supported mechanism and
        // creates the user with the default "user" role. No admin role is
        // ever assigned here.
        const created = await auth.api.createUser({
          body: { email, name, password },
        });
        return { id: created.user.id };
      },
      log: (message) => console.log(`[operator:bootstrap] ${message}`),
    });

    if (result.status === "existing") {
      console.log(
        `[operator:bootstrap] An account already exists for ${result.email}. Nothing was changed.`,
      );
    } else {
      console.log(`[operator:bootstrap] Operator account created for ${result.email}.`);
    }
    console.log(`[operator:bootstrap] User ID: ${result.userId}`);
    console.log("[operator:bootstrap] Next steps:");
    console.log(
      "  1. Add the user ID to PLATFORM_OPERATOR_USER_IDS in your local .env.local file (comma-separated for multiple operators).",
    );
    console.log("  2. Restart the application so the allowlist is reloaded.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  if (error instanceof DatabaseSafetyError || error instanceof BootstrapInputError) {
    console.error(`[operator:bootstrap] ${error.message}`);
  } else {
    console.error(
      `[operator:bootstrap] ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  process.exitCode = 1;
});
