import { devices, defineConfig } from "@playwright/test";
import { readE2eState } from "./tests/e2e-support/e2e-state";
import {
  loadLocalEnvFiles,
  redirectDatabaseUrlToTestDatabase,
} from "./tests/helpers/test-environment";

// Load ignored local env files (real process env still wins) before reading configuration.
loadLocalEnvFiles();

// Fail fast when the test database is missing or unsafe, then point
// DATABASE_URL at the test database for this process and everything it spawns
// (including the application server below). Automated tests must never touch
// the development or production database.
redirectDatabaseUrlToTestDatabase();

// The test accounts are seeded against the test database by
// `npm run test:e2e:prepare` (run automatically by `npm run test:e2e`) before
// this configuration is loaded. The operator allowlist for the test server is
// derived from the seeded operator's verified user ID — never from a role.
const e2eState = readE2eState();
process.env.PLATFORM_OPERATOR_USER_IDS = e2eState.operatorUserId;

const PORT = 3100;
// Use `localhost` (not 127.0.0.1) so Next.js dev resources (including HMR) are
// treated as same-origin by the development server.
const baseURL = `http://localhost:${PORT}`;

// The application server must use the same origin for Better Auth as the
// browser does, so set it for this process and the spawned server.
process.env.BETTER_AUTH_URL = baseURL;

export default defineConfig({
  testDir: "./e2e",
  // Playwright gives every test an isolated browser context by default: tests
  // share no cookies, storage, or sessions. Each test file also runs in its own
  // worker process.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  // The webServer runs `next dev`, which compiles routes on first request.
  // Assertions therefore get a longer timeout than the 5s default so a cold
  // dev-server compile cannot look like a product failure.
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // After the run (including failed runs), remove exactly the accounts and
  // organizations that the tests recorded, using the validated test database
  // only. Never touches records that were not created by a recorded E2E run.
  globalTeardown: "./tests/e2e-support/global-teardown.ts",
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    timeout: 120_000,
    // Never reuse an already-running server: it cannot be guaranteed to have
    // been started with the test database configuration above.
    reuseExistingServer: false,
  },
});
