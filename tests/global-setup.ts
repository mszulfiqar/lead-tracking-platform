import { migrateTestDatabase } from "./helpers/migrate-test-database";
import { loadLocalEnvFiles } from "./helpers/test-environment";

// Runs once per `vitest run`, before any test worker starts: loads ignored
// local env files and brings the dedicated test database up to the committed
// Drizzle schema. Never touches the development or production database.
export default async function globalSetup(): Promise<void> {
  loadLocalEnvFiles();
  const { database } = await migrateTestDatabase();
  console.log(`[vitest] Test database ready: ${database}`);
}
