import { expect, test } from "@playwright/test";

import { login } from "./session-fixture";

test.describe("Authentication flows", () => {
  test("login page renders and accepts credentials", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/Smart-Job/);
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"], input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("login resolves the explicit tenant and preserves the opaque session", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/app\/c\/101$/);

    await page.reload();
    await expect(page).toHaveURL(/\/app\/c\/101$/);
    await expect(page.getByRole("heading", { name: "Fixture HVAC" })).toBeVisible();
  });

  test("logout revokes the session and protects app routes", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login$/, { timeout: 10_000 });

    await page.goto("/app");
    await page.waitForURL(/\/login\?redirect=/, { timeout: 10_000 });
  });
});

test.describe("Workspace routing", () => {
  test("unauthenticated app and tenant URLs redirect to login", async ({ page }) => {
    await page.goto("/app");
    await page.waitForURL(/\/login\?redirect=/, { timeout: 10_000 });

    await page.goto("/app/c/99999");
    await page.waitForURL(/\/login\?redirect=/, { timeout: 10_000 });
  });

  test("an authenticated viewer cannot cross the explicit tenant boundary", async ({ page }) => {
    await login(page);
    await page.goto("/app/c/99999");
    await expect(page.getByRole("heading", { name: "Workspace not available" })).toBeVisible();
    await expect(page.getByText(/not included in your current memberships/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fixture HVAC" })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
  });
});

test.describe("Security assertions", () => {
  test("Firebase credentials never enter browser storage, cookies, or HTML", async ({ page }) => {
    await login(page);

    const cookies = await page.context().cookies();
    const forbiddenCookies = cookies.filter(
      (cookie) => cookie.name.includes("access_token")
        || cookie.name.includes("refresh_token")
        || cookie.name.includes("__session_access"),
    );
    expect(forbiddenCookies).toHaveLength(0);
    expect(cookies.some((cookie) => cookie.name === "sj_web_session" && cookie.httpOnly)).toBe(true);

    const browserStorage = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
      html: document.documentElement.outerHTML,
    }));
    for (const value of Object.values(browserStorage)) {
      expect(value).not.toContain("access_token");
      expect(value).not.toContain("refresh_token");
      expect(value).not.toContain("sb_access_token");
    }
  });
});
