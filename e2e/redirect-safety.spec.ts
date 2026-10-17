import { expect, test } from "@playwright/test";

import { readE2eState } from "../tests/e2e-support/e2e-state";

// Browser acceptance tests proving the sign-in flow never becomes an open
// redirect. A `next` value is honored only as a validated same-origin
// application path; everything else is ignored, and the final destination is
// always resolved on the server from verified session state.
const state = readE2eState();

async function signInWithNext(
  page: import("@playwright/test").Page,
  next: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("sign-in redirect safety", () => {
  test("external next values are ignored and never redirect off-site", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Playwright baseURL is required for this test.");

    await signInWithNext(
      page,
      "https://example.com/phishing",
      state.memberEmail,
      state.memberPassword,
    );

    // The member's real destination is resolved server-side; the injected
    // external URL is discarded.
    await expect(page).toHaveURL(/\/no-access$/);
    expect(page.url().startsWith(baseURL)).toBe(true);
    expect(page.url()).not.toContain("example.com");
  });

  test("protocol-relative next values are ignored", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("Playwright baseURL is required for this test.");

    await signInWithNext(
      page,
      "//example.com/phishing",
      state.memberEmail,
      state.memberPassword,
    );

    await expect(page).toHaveURL(/\/no-access$/);
    expect(page.url().startsWith(baseURL)).toBe(true);
  });

  test("backslash next values are ignored", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("Playwright baseURL is required for this test.");

    await signInWithNext(
      page,
      "/\\evil.example.com/phishing",
      state.memberEmail,
      state.memberPassword,
    );

    await expect(page).toHaveURL(/\/no-access$/);
    expect(page.url().startsWith(baseURL)).toBe(true);
  });

  test("absolute same-host next values are ignored", async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("Playwright baseURL is required for this test.");

    await signInWithNext(
      page,
      `${baseURL}/operator`,
      state.memberEmail,
      state.memberPassword,
    );

    // A member must not end up on the operator console even though the
    // injected URL points at this host.
    await expect(page).toHaveURL(/\/no-access$/);
    await expect(page.getByRole("heading", { name: "Operator console" })).toHaveCount(0);
  });

  test("an operator with an external next value still lands on the operator console", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Playwright baseURL is required for this test.");

    await signInWithNext(
      page,
      "https://example.com/phishing",
      state.operatorEmail,
      state.operatorPassword,
    );

    // The destination comes from verified server-side operator state, not
    // from the client-supplied `next` value.
    await expect(page).toHaveURL(/\/operator$/);
    expect(page.url().startsWith(baseURL)).toBe(true);
  });
});
