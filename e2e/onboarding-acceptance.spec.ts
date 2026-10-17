import { randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { recordE2eRunArtifacts } from "../tests/e2e-support/e2e-artifacts";
import { readE2eState } from "../tests/e2e-support/e2e-state";

/**
 * Browser acceptance journey for operator-managed onboarding (tasks 4.8, 5.6,
 * 6.3, 6.4).
 *
 * Everything runs against the real application through real browser
 * interactions: the allowlisted operator (seeded by `test:e2e:prepare` and
 * allowlisted through `PLATFORM_OPERATOR_USER_IDS` by the Playwright config)
 * provisions client workspaces through the operator console form, and the
 * provisioned clients then sign in through the shared sign-in page.
 *
 * Isolation guarantees:
 * - Every email and workspace slug contains a per-run random suffix, so no
 *   test data can collide with another run or with real data.
 * - The identifiers this run may create are recorded in a run artifact file
 *   *before* provisioning starts; the Playwright global teardown (and the
 *   next `test:e2e:prepare`) deletes only those exact records. No test can
 *   delete a user or organization it did not create.
 * - Every test gets an isolated browser context (Playwright default): no
 *   cookies or storage are shared between tests.
 */
const state = readE2eState();

function freshPassword(): string {
  // 24 random bytes -> 32 URL-safe characters, inside the 8-128 policy.
  return randomBytes(24).toString("base64url");
}

const runId = randomUUID();
const suffix = runId.slice(0, 8);

const clientA = {
  companyName: `Acceptance Client A ${suffix}`,
  slug: `acceptance-client-a-${suffix}`,
  ownerName: "Acceptance Owner A",
  ownerEmail: `acceptance-owner-a-${suffix}@example.test`,
  initialPassword: freshPassword(),
};

const clientB = {
  companyName: `Acceptance Client B ${suffix}`,
  slug: `acceptance-client-b-${suffix}`,
  ownerName: "Acceptance Owner B",
  ownerEmail: `acceptance-owner-b-${suffix}@example.test`,
  initialPassword: freshPassword(),
};

const duplicateEmailAttempt = {
  companyName: `Duplicate Email HVAC ${suffix}`,
  slug: `acceptance-duplicate-email-${suffix}`,
  ownerName: "Duplicate Email Owner",
  initialPassword: freshPassword(),
};

const duplicateSlugAttempt = {
  companyName: `Duplicate Slug HVAC ${suffix}`,
  ownerName: "Duplicate Slug Owner",
  ownerEmail: `acceptance-duplicate-slug-${suffix}@example.test`,
  initialPassword: freshPassword(),
};

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Signs out and verifies the session is really gone before anything else
 * happens. A protected route must bounce an anonymous visitor back to the
 * sign-in page; waiting for that removes any sign-out/sign-in race from the
 * test itself (and asserts sign-out actually ends the session).
 */
async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.goto("/workspace");
  await expect(page).toHaveURL((url) => url.pathname === "/sign-in");
}

async function fillProvisionForm(
  page: Page,
  values: {
    companyName: string;
    slug: string;
    ownerName: string;
    ownerEmail: string;
    initialPassword: string;
  },
): Promise<void> {
  // Company name first: the form auto-generates a slug from it, and the
  // explicit slug below always overwrites that generated value.
  await page.getByLabel("Company name", { exact: true }).fill(values.companyName);
  await page.getByLabel("Workspace link (slug)", { exact: true }).fill(values.slug);
  await page.getByLabel("Client owner's name", { exact: true }).fill(values.ownerName);
  await page.getByLabel("Client owner's email", { exact: true }).fill(values.ownerEmail);
  await page.getByLabel("Initial password", { exact: true }).fill(values.initialPassword);
  await page
    .getByLabel("Confirm initial password", { exact: true })
    .fill(values.initialPassword);
}

async function expectProvisioned(
  page: Page,
  values: { companyName: string; slug: string },
): Promise<void> {
  const success = page
    .getByRole("status")
    .filter({ hasText: "Client workspace provisioned" });
  await expect(success).toBeVisible();
  await expect(success).toContainText(values.companyName);
  await expect(success).toContainText(values.slug);

  // Fields are cleared after verified success, so no credential remains even
  // in the form's own field state.
  await expect(page.getByLabel("Initial password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Confirm initial password", { exact: true })).toHaveValue("");
}

/** Everything the browser stores client-side: web storage and cookies. */
async function browserStorageDump(page: Page): Promise<string> {
  const webStorage = await page.evaluate(() => {
    const entries: Record<string, string> = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? "";
      entries[`local:${key}`] = localStorage.getItem(key) ?? "";
    }
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index) ?? "";
      entries[`session:${key}`] = sessionStorage.getItem(key) ?? "";
    }
    return JSON.stringify(entries);
  });
  const cookies = await page.context().cookies();
  const cookieDump = JSON.stringify(
    cookies.map(({ name, value }) => ({ name, value })),
  );
  return `${webStorage}\n${cookieDump}`;
}

/**
 * Installs an in-page observer that records the text of every POST response
 * body the page receives.
 *
 * Reading a streamed server-action response out of band races with the
 * browser discarding the network resource for it ("No data found for resource
 * with given identifier"), so the payload is captured in the page itself,
 * where the application genuinely consumes it. The observer only observes:
 * the original response object is returned untouched.
 */
async function installPostResponseObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface PostResponseCapture {
      bodies: string[];
      pending: Promise<void>[];
    }
    const capture: PostResponseCapture = { bodies: [], pending: [] };
    (
      window as unknown as { __e2ePostResponseCapture?: PostResponseCapture }
    ).__e2ePostResponseCapture = capture;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : undefined;
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const response = await originalFetch(input, init);
      if (method === "POST") {
        try {
          capture.pending.push(
            response
              .clone()
              .text()
              .then((text) => {
                capture.bodies.push(text);
              })
              .catch(() => {}),
          );
        } catch {
          // Cloning is best-effort: the application does not use
          // non-cloneable responses.
        }
      }
      return response;
    };
  });
}

/** Returns every POST response body observed so far (captures included). */
async function readObservedPostResponseBodies(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const capture = (
      window as unknown as {
        __e2ePostResponseCapture?: {
          bodies: string[];
          pending: Promise<void>[];
        };
      }
    ).__e2ePostResponseCapture;
    if (!capture) return [];
    await Promise.all(capture.pending);
    return capture.bodies;
  });
}

// Onboarding is a true journey: provisioning, sign-out/sign-in, and tenant
// checks must run in order against the data the previous step created.
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("operator-managed onboarding acceptance", () => {
  test.beforeAll(() => {
    // Record the exact identifiers this run may create before any data
    // exists, so even a crashed run can be cleaned up precisely.
    recordE2eRunArtifacts({
      userEmails: [
        clientA.ownerEmail,
        clientB.ownerEmail,
        duplicateSlugAttempt.ownerEmail,
      ],
      organizationSlugs: [
        clientA.slug,
        clientB.slug,
        duplicateEmailAttempt.slug,
      ],
    });
  });

  test("operator provisions a client workspace and the new client signs in to exactly that workspace", async ({
    page,
  }) => {
    await installPostResponseObserver(page);

    await test.step("sign in as the allowlisted operator", async () => {
      await signIn(page, state.operatorEmail, state.operatorPassword);
      await expect(page).toHaveURL(/\/operator$/);
      await expect(
        page.getByRole("heading", { name: "Operator console" }),
      ).toBeVisible();
    });

    await test.step("provision client A through the console", async () => {
      await fillProvisionForm(page, clientA);
      await page.getByRole("button", { name: "Create client workspace" }).click();

      await expectProvisioned(page, clientA);

      // The initial password must not be exposed in the result panel, the
      // rendered page, the URL, the browser's storage, or any POST response
      // payload the page received.
      await expect(page.getByRole("status")).not.toContainText(
        clientA.initialPassword,
      );
      expect(await page.locator("body").innerText()).not.toContain(
        clientA.initialPassword,
      );
      expect(await page.content()).not.toContain(clientA.initialPassword);
      expect(page.url()).not.toContain(clientA.initialPassword);
      expect(await browserStorageDump(page)).not.toContain(
        clientA.initialPassword,
      );

      // The provisioning response really carried the result (so this check is
      // not vacuous) and did not carry the password.
      const observedPostBodies = (
        await readObservedPostResponseBodies(page)
      ).join("\n");
      expect(observedPostBodies).toContain(clientA.companyName);
      expect(observedPostBodies).not.toContain(clientA.initialPassword);
    });

    await test.step("a duplicate email is reported as a conflict, never as success", async () => {
      await fillProvisionForm(page, {
        companyName: duplicateEmailAttempt.companyName,
        slug: duplicateEmailAttempt.slug,
        ownerName: duplicateEmailAttempt.ownerName,
        ownerEmail: clientA.ownerEmail,
        initialPassword: duplicateEmailAttempt.initialPassword,
      });
      await page.getByRole("button", { name: "Create client workspace" }).click();

      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "An account already exists for this email address." })
          .first(),
      ).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(page.getByText("Client workspace provisioned")).toHaveCount(0);
    });

    await test.step("provision client B through the console", async () => {
      await fillProvisionForm(page, clientB);
      await page.getByRole("button", { name: "Create client workspace" }).click();

      await expectProvisioned(page, clientB);
      expect(await page.locator("body").innerText()).not.toContain(
        clientB.initialPassword,
      );
    });

    await test.step("a duplicate workspace link is reported as a conflict, never as success", async () => {
      await fillProvisionForm(page, {
        companyName: duplicateSlugAttempt.companyName,
        slug: clientB.slug,
        ownerName: duplicateSlugAttempt.ownerName,
        ownerEmail: duplicateSlugAttempt.ownerEmail,
        initialPassword: duplicateSlugAttempt.initialPassword,
      });
      await page.getByRole("button", { name: "Create client workspace" }).click();

      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "already in use" })
          .first(),
      ).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(page.getByText("Client workspace provisioned")).toHaveCount(0);
    });

    await test.step("sign out; the operator session really ends", async () => {
      await signOut(page);
    });

    await test.step("the new client signs in with the initial password and reaches its own workspace", async () => {
      await signIn(page, clientA.ownerEmail, clientA.initialPassword);

      await expect(page).toHaveURL(/\/workspace$/);
      await expect(
        page.getByRole("heading", { name: clientA.companyName }),
      ).toBeVisible();
      await expect(page.getByText(clientA.ownerEmail)).toBeVisible();
      await expect(page.getByText(/as the workspace owner/)).toBeVisible();
    });

    await test.step("the client cannot reach the operator console", async () => {
      await page.goto("/operator");

      await expect(page).toHaveURL(/\/no-access$/);
      await expect(
        page.getByRole("heading", { name: "Operator console" }),
      ).toHaveCount(0);

      // Back to its own workspace for the tampering checks below.
      await page.goto("/workspace");
      await expect(
        page.getByRole("heading", { name: clientA.companyName }),
      ).toBeVisible();
    });

    await test.step("query parameters naming another tenant cannot switch the client's workspace", async () => {
      await page.goto(
        `/workspace?organizationId=forged-organization-id` +
          `&organizationSlug=${clientB.slug}&slug=${clientB.slug}`,
      );

      await expect(
        page.getByRole("heading", { name: clientA.companyName }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: clientB.companyName }),
      ).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(clientB.companyName);
      await expect(page.locator("body")).not.toContainText(clientB.slug);
    });

    await test.step("forged organization-identifying headers cannot switch the client's workspace", async () => {
      await page.setExtraHTTPHeaders({
        "x-organization-id": "forged-organization-id",
        "x-organization-slug": clientB.slug,
        "organization-id": "forged-organization-id",
        "organization-slug": clientB.slug,
      });
      try {
        await page.goto("/workspace");

        await expect(
          page.getByRole("heading", { name: clientA.companyName }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: clientB.companyName }),
        ).toHaveCount(0);
        await expect(page.locator("body")).not.toContainText(clientB.companyName);
        await expect(page.locator("body")).not.toContainText(clientB.slug);
      } finally {
        await page.setExtraHTTPHeaders({});
      }
    });
  });

  test("provisioned clients are tenant-isolated and a non-member has no workspace access", async ({
    page,
  }) => {
    await test.step("client B sees only its own workspace", async () => {
      await signIn(page, clientB.ownerEmail, clientB.initialPassword);

      await expect(page).toHaveURL(/\/workspace$/);
      await expect(
        page.getByRole("heading", { name: clientB.companyName }),
      ).toBeVisible();
      await expect(page.getByText(clientB.ownerEmail)).toBeVisible();

      // None of client A's data is visible to client B.
      await expect(page.locator("body")).not.toContainText(clientA.companyName);
      await expect(page.locator("body")).not.toContainText(clientA.slug);
      await expect(page.locator("body")).not.toContainText(clientA.ownerEmail);
    });

    await test.step("sign out", async () => {
      await signOut(page);
    });

    await test.step("a signed-in non-member is denied the workspace", async () => {
      await signIn(page, state.memberEmail, state.memberPassword);
      await expect(page).toHaveURL(/\/no-access$/);
      await expect(
        page.getByRole("heading", { name: "No workspace access yet" }),
      ).toBeVisible();

      // Direct navigation to the workspace is denied on the server.
      await page.goto("/workspace");
      await expect(page).toHaveURL(/\/no-access$/);
      await expect(page.getByRole("heading", { name: "Client workspace" })).toHaveCount(
        0,
      );

      // No provisioned tenant's data leaks to the non-member.
      await expect(page.locator("body")).not.toContainText(clientA.companyName);
      await expect(page.locator("body")).not.toContainText(clientB.companyName);
    });

    await test.step("the non-member is denied the operator console", async () => {
      await page.goto("/operator");

      await expect(page).toHaveURL(/\/no-access$/);
      await expect(
        page.getByRole("heading", { name: "Operator console" }),
      ).toHaveCount(0);
    });
  });
});
