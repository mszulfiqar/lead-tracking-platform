/**
 * Run-scoped data tracking for the Playwright acceptance suite.
 *
 * Acceptance tests provision real client workspaces in the dedicated test
 * database, so every run must be able to remove exactly what it created — and
 * nothing else. Before any data is provisioned, a run records the unique
 * account emails and organization slugs it may create in a per-run artifact
 * file under the git-ignored `.e2e-state/` directory.
 *
 * Cleanup (`e2e-cleanup.ts`) deletes users and organizations only by these
 * exact recorded identifiers. It never deletes by pattern, role, domain, or
 * any shared attribute, so a record not created by an E2E run can never be
 * touched. If a run crashes before cleanup, the next `test:e2e:prepare`
 * removes the leftovers using the same recorded identifiers.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const E2E_ARTIFACTS_DIR = path.join(
  process.cwd(),
  ".e2e-state",
  "artifacts",
);

export interface E2eRunArtifacts {
  runId: string;
  recordedAt: string;
  /** Exact account emails this run may create. Deleted only by exact match. */
  userEmails: string[];
  /** Exact organization slugs this run may create. Deleted only by exact match. */
  organizationSlugs: string[];
}

export interface RecordedE2eRunArtifacts extends E2eRunArtifacts {
  filePath: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function requireIdentifierList(
  value: unknown,
  field: "userEmails" | "organizationSlugs",
  filePath: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error(
      `E2E artifact file ${filePath} has an invalid "${field}" list; refusing to use it for cleanup.`,
    );
  }
  const identifiers = value as string[];
  for (const identifier of identifiers) {
    const valid =
      field === "userEmails"
        ? EMAIL_PATTERN.test(identifier)
        : SLUG_PATTERN.test(identifier);
    if (!valid) {
      throw new Error(
        `E2E artifact file ${filePath} contains an invalid ${field} entry; refusing to use it for cleanup.`,
      );
    }
  }
  return identifiers;
}

/**
 * Records the exact identifiers a test run may create. The file is written
 * before provisioning starts (atomically: a temp file is renamed into place)
 * so even a crashed run leaves a complete, machine-readable record for the
 * next cleanup.
 */
export function recordE2eRunArtifacts(input: {
  userEmails?: string[];
  organizationSlugs?: string[];
}): RecordedE2eRunArtifacts {
  fs.mkdirSync(E2E_ARTIFACTS_DIR, { recursive: true });

  const runId = crypto.randomUUID();
  const payload: E2eRunArtifacts = {
    runId,
    recordedAt: new Date().toISOString(),
    userEmails: [
      ...new Set(
        (input.userEmails ?? [])
          .map((email) => email.trim().toLowerCase())
          .filter((email) => email !== ""),
      ),
    ],
    organizationSlugs: [
      ...new Set(
        (input.organizationSlugs ?? [])
          .map((slug) => slug.trim())
          .filter((slug) => slug !== ""),
      ),
    ],
  };

  const filePath = path.join(E2E_ARTIFACTS_DIR, `${runId}.json`);
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(tempPath, filePath);

  return { ...payload, filePath };
}

/**
 * Reads every recorded run artifact. Invalid files fail loudly instead of
 * being skipped: silently ignoring a corrupted record would leave test data
 * behind without anyone noticing.
 */
export function readE2eRunArtifacts(): RecordedE2eRunArtifacts[] {
  if (!fs.existsSync(E2E_ARTIFACTS_DIR)) return [];

  const fileNames = fs
    .readdirSync(E2E_ARTIFACTS_DIR)
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  return fileNames.map((fileName) => {
    const filePath = path.join(E2E_ARTIFACTS_DIR, fileName);

    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      throw new Error(`E2E artifact file ${filePath} is not valid JSON.`);
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`E2E artifact file ${filePath} does not contain an object.`);
    }

    const record = parsed as Partial<E2eRunArtifacts>;
    if (typeof record.runId !== "string" || record.runId === "") {
      throw new Error(`E2E artifact file ${filePath} is missing its run ID.`);
    }

    return {
      runId: record.runId,
      recordedAt:
        typeof record.recordedAt === "string" ? record.recordedAt : "",
      userEmails: requireIdentifierList(
        record.userEmails,
        "userEmails",
        filePath,
      ),
      organizationSlugs: requireIdentifierList(
        record.organizationSlugs,
        "organizationSlugs",
        filePath,
      ),
      filePath,
    };
  });
}

/**
 * Removes one artifact file after its recorded identifiers have been verified
 * as deleted (or when nothing was created for them).
 */
export function removeE2eRunArtifactFile(filePath: string): void {
  fs.rmSync(filePath, { force: true });
}

/**
 * Removes leftover temp files from an interrupted artifact write. Only used
 * when no writer can be active: in the Playwright teardown (after all workers
 * finished) and in `test:e2e:prepare` (before any worker starts).
 */
export function removeE2eArtifactTempFiles(): void {
  if (!fs.existsSync(E2E_ARTIFACTS_DIR)) return;
  for (const fileName of fs.readdirSync(E2E_ARTIFACTS_DIR)) {
    if (fileName.endsWith(".tmp")) {
      fs.rmSync(path.join(E2E_ARTIFACTS_DIR, fileName), { force: true });
    }
  }
}
