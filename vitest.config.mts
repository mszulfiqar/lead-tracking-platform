import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Server-side unit and integration tests; no DOM is required.
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Loads ignored local env files and fails fast when TEST_DATABASE_URL is
    // missing or unsafe; see tests/helpers/test-environment.ts.
    setupFiles: ["./tests/setup.ts"],
    // Migrates the validated test database to the committed Drizzle schema
    // once per run, before any test worker starts.
    globalSetup: ["./tests/global-setup.ts"],
  },
});
