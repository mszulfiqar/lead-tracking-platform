import { setupTestEnvironment } from "./helpers/test-environment";

// Runs before every Vitest worker: loads local env files, validates
// TEST_DATABASE_URL, and redirects DATABASE_URL to the test database.
setupTestEnvironment();
