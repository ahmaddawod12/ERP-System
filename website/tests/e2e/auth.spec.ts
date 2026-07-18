import { expect, test } from "@playwright/test";

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";
const HAS_TEST_CREDENTIALS = TEST_EMAIL.length > 0 && TEST_PASSWORD.length > 0;

function requireTestCredentials(): void {
  test.skip(!HAS_TEST_CREDENTIALS, "E2E test credentials are not configured");
}

test.describe("Authentication flows", () => {
  test("login page renders and accepts credentials", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/Smart-Job/);

    const emailInput = page.locator('input[type="email"], input[name="email"]');
    await expect(emailInput).toBeVisible();

    const passwordInput = page.locator('input[type="password"], input[name="password"]');
    await expect(passwordInput).toBeVisible();

    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
  });

  test("login redirects to app on success", async ({ page }) => {
    requireTestCredentials();
    await page.goto("/login");

    await page.locator('input[type="email"], input[name="email"]').fill(TEST_EMAIL);
    await page.locator('input[type="password"], input[name="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    await page.waitForURL(/\/app/, { timeout: 15_000 });
    expect(page.url()).toContain("/app");
  });

  test("hard reload preserves session", async ({ page }) => {
    requireTestCredentials();
    await page.goto("/login");
    await page.locator('input[type="email"], input[name="email"]').fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app/);

    await page.reload();
    await page.waitForURL(/\/app/);
    expect(page.url()).toContain("/app");
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    requireTestCredentials();
    await page.goto("/login");
    await page.locator('input[type="email"], input[name="email"]').fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app/);

    const logoutButton = page.locator("button", { hasText: /logout|sign out/i });
    if (await logoutButton.isVisible()) {
      await logoutButton.click();
      await page.waitForURL(/\/login/, { timeout: 10_000 });
    }

    await page.goto("/app");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });
});

test.describe("Workspace routing", () => {
  test("unauthenticated access to /app redirects to login", async ({ page }) => {
    await page.goto("/app");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });

  test("forged tenant URL redirects to login when unauthenticated", async ({ page }) => {
    await page.goto("/app/c/99999");
    await page.waitForURL(/\/login/, { timeout: 10_000 });
  });
});

test.describe("Security assertions", () => {
  test("no Supabase access token in browser storage after login", async ({ page }) => {
    requireTestCredentials();
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/app/);

    const cookies = await page.context().cookies();
    const tokenCookies = cookies.filter(
      (c) => c.name.includes("access_token") || c.name.includes("__session_access"),
    );
    expect(tokenCookies).toHaveLength(0);

    const localStorageDump = await page.evaluate(() => JSON.stringify(localStorage));
    expect(localStorageDump).not.toContain("access_token");
    expect(localStorageDump).not.toContain("refresh_token");

    const sessionStorageDump = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(sessionStorageDump).not.toContain("access_token");
  });

  test("no Supabase token in page HTML", async ({ page }) => {
    await page.goto("/login");
    const html = await page.content();
    expect(html).not.toContain("sb_access_token");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain("refresh_token");
  });
});
