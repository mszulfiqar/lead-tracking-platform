/**
 * Runtime state for the Playwright acceptance suite.
 *
 * The state file is written by `scripts/prepare-e2e.ts` before
 * `playwright test` starts (see `npm run test:e2e`) and contains the freshly
 * seeded test accounts for the run. It lives in the git-ignored `.e2e-state/`
 * directory and contains ephemeral, run-scoped test credentials only — never
 * real credentials.
 */
import fs from "node:fs";
import path from "node:path";

export const E2E_STATE_PATH = path.join(process.cwd(), ".e2e-state", "state.json");

/** Test-only account emails. They exist only in the dedicated test database. */
export const E2E_OPERATOR_EMAIL = "e2e-operator@example.test";
export const E2E_MEMBER_EMAIL = "e2e-member@example.test";

export interface E2eState {
  /** Verified test database name the accounts live in. */
  database: string;
  operatorUserId: string;
  operatorEmail: string;
  operatorPassword: string;
  memberUserId: string;
  memberEmail: string;
  memberPassword: string;
}

export function writeE2eState(state: E2eState): void {
  fs.mkdirSync(path.dirname(E2E_STATE_PATH), { recursive: true });
  fs.writeFileSync(E2E_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function readE2eState(): E2eState {
  if (!fs.existsSync(E2E_STATE_PATH)) {
    throw new Error(
      `E2E runtime state not found at ${E2E_STATE_PATH}. ` +
        'Run the browser suite with "npm run test:e2e" so the test database and accounts are prepared first.',
    );
  }

  const parsed = JSON.parse(fs.readFileSync(E2E_STATE_PATH, "utf8")) as Partial<E2eState>;
  const required: Array<keyof E2eState> = [
    "database",
    "operatorUserId",
    "operatorEmail",
    "operatorPassword",
    "memberUserId",
    "memberEmail",
    "memberPassword",
  ];
  for (const key of required) {
    if (typeof parsed[key] !== "string" || parsed[key] === "") {
      throw new Error(
        `E2E runtime state is incomplete (missing "${key}"). Run "npm run test:e2e" to prepare it again.`,
      );
    }
  }
  return parsed as E2eState;
}
