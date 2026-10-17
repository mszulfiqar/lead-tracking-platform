import { expect, test, type Page } from "@playwright/test";

import { readE2eState } from "../tests/e2e-support/e2e-state";

// Browser acceptance tests for server-side platform operator authorization.
// Operator status is granted only through the server-side
// `PLATFORM_OPERATOR_USER_IDS` allowlist that playwright.config.ts derives from
// the seeded operator's verified user ID — never through a role or any
// client-supplied value.
const state = readE2eState();

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("platform operator access", () => {
  test("allowlisted operator signs in and reaches the operator console", async ({
    page,
  }) => {
    await signIn(page, state.operatorEmail, state.operatorPassword);

    await expect(page).toHaveURL(/\/operator$/);
    await expect(page.getByRole("heading", { name: "Operator console" })).toBeVisible();
    await expect(page.getByText(state.operatorEmail)).toBeVisible();
  });

  test("operator console stays reachable for an allowlisted operator", async ({
    page,
  }) => {
    await signIn(page, state.operatorEmail, state.operatorPassword);
    await expect(page).toHaveURL(/\/operator$/);

    await page.goto("/operator");
    await expect(page.getByRole("heading", { name: "Operator console" })).toBeVisible();
  });

  test("client member signs in but is denied operator access", async ({ page }) => {
    await signIn(page, state.memberEmail, state.memberPassword);

    await expect(page).toHaveURL(/\/no-access$/);
    await expect(
      page.getByRole("heading", { name: "No workspace access yet" }),
    ).toBeVisible();
    await expect(page.getByText(state.memberEmail)).toBeVisible();

    // Direct navigation to the operator console is denied on the server.
    await page.goto("/operator");
    await expect(page).toHaveURL(/\/no-access$/);
    await expect(page.getByRole("heading", { name: "Operator console" })).toHaveCount(0);
  });

  test("a member cannot gain operator access by tampering with the sign-in URL", async ({
    page,
  }) => {
    await page.goto("/sign-in?next=%2Foperator");
    await page.getByLabel("Email").fill(state.memberEmail);
    await page.getByLabel("Password").fill(state.memberPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    // The return-to path leads to /operator, but the server denies the member
    // and redirects to the no-access page; the operator console never renders.
    await expect(page).toHaveURL(/\/no-access$/);
    await expect(page.getByRole("heading", { name: "Operator console" })).toHaveCount(0);
  });

  test("a forged session cookie does not grant operator access", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Playwright baseURL is required for this test.");
    await page.context().addCookies([
      {
        name: "better-auth.session_token",
        value: "forged-session-token",
        url: baseURL,
      },
    ]);

    await page.goto("/operator");

    // The optimistic proxy sees a session cookie and lets the request through;
    // the page's server-side session check rejects it and redirects to the
    // shared sign-in page.
    await expect(page).toHaveURL((url) => url.pathname === "/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("signing out ends the session and re-protects the operator console", async ({
    page,
  }) => {
    await signIn(page, state.operatorEmail, state.operatorPassword);
    await expect(page).toHaveURL(/\/operator$/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    await page.goto("/operator");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/sign-in" && url.searchParams.get("next") === "/operator",
    );
  });
});
