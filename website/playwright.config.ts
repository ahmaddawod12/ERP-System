import { defineConfig, devices } from "@playwright/test";

const managedFixture = !process.env.PLAYWRIGHT_BASE_URL;
const websiteOrigin = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const fullReleaseMatrix = process.env.PLAYWRIGHT_FULL_MATRIX === "true";

const releaseProjects = fullReleaseMatrix
  ? [
      {
        name: "firefox-desktop",
        use: { ...devices["Desktop Firefox"] },
      },
      {
        name: "webkit-desktop",
        use: { ...devices["Desktop Safari"] },
      },
      {
        name: "android",
        use: { ...devices["Pixel 5"] },
      },
      {
        name: "iphone",
        use: { ...devices["iPhone 13"] },
      },
    ]
  : [];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: websiteOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 5"] },
    },
    ...releaseProjects,
  ],
  webServer: managedFixture
    ? [
        {
          command: "node tests/e2e/fixture-backend.mjs",
          url: "http://127.0.0.1:4100/healthz",
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
          url: websiteOrigin,
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            BACKEND_API_BASE_URL: "http://127.0.0.1:4100",
            BACKEND_API_TIMEOUT_MS: "3000",
            WEBSITE_ORIGIN: websiteOrigin,
          },
        },
      ]
    : undefined,
});
