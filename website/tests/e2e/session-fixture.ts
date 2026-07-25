import { expect, test, type Page } from "@playwright/test";

const USING_LOCAL_FIXTURE = !process.env.PLAYWRIGHT_BASE_URL;
const TEST_EMAIL = process.env.E2E_TEST_EMAIL
  ?? (USING_LOCAL_FIXTURE ? "manager@example.test" : "");
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD
  ?? (USING_LOCAL_FIXTURE ? "fixture-password" : "");
const HAS_TEST_CREDENTIALS = TEST_EMAIL.length > 0 && TEST_PASSWORD.length > 0;

export function requireTestCredentials(): void {
  test.skip(!HAS_TEST_CREDENTIALS, "E2E test credentials are not configured");
}

export async function login(page: Page): Promise<void> {
  requireTestCredentials();
  await page.goto("/login");
  await page.locator('input[type="email"], input[name="email"]').fill(TEST_EMAIL);
  await page.locator('input[type="password"], input[name="password"]').fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/app\/c\/101$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Fixture HVAC" })).toBeVisible();
}
