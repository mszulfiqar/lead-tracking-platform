import { expect, test } from "@playwright/test";

// Minimal smoke test: proves the application server boots with the test
// environment and renders a page. Real acceptance tests for sign-in, operator
// access, and onboarding are added by later approved tasks; this assertion is
// intentionally resilient to page content changes.
test("home page renders without server errors", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page.locator("h1")).toBeVisible();
});
