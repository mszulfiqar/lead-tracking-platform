import { expect, test } from "@playwright/test";

import { readE2eState } from "../tests/e2e-support/e2e-state";

// Browser acceptance tests for the shared sign-in page. They run against the
// dedicated test database prepared by `npm run test:e2e:prepare`; the seeded
// credentials live only in the git-ignored runtime state file.
const state = readE2eState();

test.describe("shared sign-in", () => {
  test("home page links to the shared sign-in page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("anonymous visitors are redirected from protected routes to sign-in", async ({
    page,
  }) => {
    await page.goto("/operator");

    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/sign-in" && url.searchParams.get("next") === "/operator",
    );
  });

  test("invalid credentials show a generic error and grant no session", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(state.memberEmail);
    await page.getByLabel("Password").fill("definitely-not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();

    // The error is deliberately generic: it must not reveal whether the
    // account exists. (The Next.js route announcer also has role="alert", so
    // scope the assertion to the message itself.)
    await expect(
      page.getByRole("alert").filter({ hasText: "Invalid email or password." }),
    ).toHaveText("Invalid email or password.");

    // The visitor stays anonymous: protected routes still require sign-in.
    await page.goto("/operator");
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/sign-in" && url.searchParams.get("next") === "/operator",
    );
  });

  test("public sign-up through the auth API is disabled and creates no session", async ({
    request,
  }) => {
    const response = await request.post("/api/auth/sign-up/email", {
      data: {
        email: "e2e-blocked-signup@example.test",
        password: "blocked-signup-password-1",
        name: "Blocked Signup",
      },
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("EMAIL_PASSWORD_SIGN_UP_DISABLED");
    expect(response.headers()["set-cookie"]).toBeUndefined();
  });
});
