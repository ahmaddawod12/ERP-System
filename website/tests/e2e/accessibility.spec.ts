import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { login } from "./session-fixture";

const WCAG_22_AA_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

async function expectWcag22Aa(page: Page, journey: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_22_AA_TAGS])
    .analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
  expect(summary, `${journey} must have no WCAG 2.2 A/AA violations`).toEqual([]);
}

test.describe("WCAG 2.2 AA journeys", () => {
  test("login is keyboard reachable and passes automated checks", async ({ page }) => {
    await page.goto("/login");
    await expectWcag22Aa(page, "Login");

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("authenticated core workspace pages pass automated checks", async ({ page }) => {
    await login(page);

    const corePages = [
      { path: "/app/c/101", name: "Overview" },
      { path: "/app/c/101/jobs", name: "Jobs" },
      { path: "/app/c/101/clients", name: "Clients" },
      { path: "/app/c/101/inventory", name: "Inventory" },
      { path: "/app/c/101/documents", name: "Documents" },
      { path: "/app/c/101/workers", name: "Team" },
      { path: "/app/c/101/settings", name: "Settings" },
    ];

    for (const corePage of corePages) {
      await page.goto(corePage.path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectWcag22Aa(page, corePage.name);
    }
  });

  test("modal traps focus, hides the background, and restores focus", async ({ page }) => {
    await login(page);
    await page.goto("/app/c/101/clients");

    const trigger = page.getByRole("button", { name: "New client" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Add client" });
    await expect(dialog).toBeVisible();
    await expectWcag22Aa(page, "Add client modal");
    await expect(page.locator("body > :not([data-smart-job-modal-root])").first()).toHaveAttribute("inert", "");

    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      const focusInsideDialog = await page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement && active.closest('[role="dialog"]') !== null;
      });
      expect(focusInsideDialog).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
