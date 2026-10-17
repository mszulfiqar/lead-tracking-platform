/**
 * Playwright global teardown for the browser acceptance suite.
 *
 * Runs after every test worker has finished (including failed runs) and
 * removes only the accounts and organizations recorded by this run, using the
 * validated test database exclusively. See `e2e-cleanup.ts` for the exact
 * safety properties. If this process is killed before teardown runs, the next
 * `test:e2e:prepare` removes the recorded leftovers instead.
 */
import { cleanupE2eRunData } from "./e2e-cleanup";

export default async function globalTeardown(): Promise<void> {
  const report = await cleanupE2eRunData();

  if (!report) {
    console.log(
      "[e2e:cleanup] No run-created E2E records were recorded; nothing to clean up.",
    );
    return;
  }

  console.log(
    `[e2e:cleanup] Removed ${report.deletedUsers} run-created user(s) and ` +
      `${report.deletedOrganizations} run-created organization(s) from ${report.database}.`,
  );
}
