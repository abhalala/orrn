import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3001";

/** Dummy API URL for public-route visual tests (no live server required). */
const visualTestEnv = {
  VITE_SERVER_URL: process.env.VITE_SERVER_URL ?? "http://127.0.0.1:8787",
  VITE_PUBLIC_URL: process.env.VITE_PUBLIC_URL ?? baseURL,
};

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-dark",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 }, colorScheme: "dark" },
    },
    {
      name: "mobile-dark",
      use: {
        ...devices["Desktop Chrome"],
        viewport: devices["iPhone 13"].viewport,
        userAgent: devices["iPhone 13"].userAgent,
        isMobile: true,
        hasTouch: true,
        colorScheme: "dark",
      },
    },
    {
      name: "desktop-light",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 }, colorScheme: "light" },
    },
    {
      name: "mobile-light",
      use: {
        ...devices["Desktop Chrome"],
        viewport: devices["iPhone 13"].viewport,
        userAgent: devices["iPhone 13"].userAgent,
        isMobile: true,
        hasTouch: true,
        colorScheme: "light",
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "bun run dev:bare -- --host 127.0.0.1 --port 3001",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: visualTestEnv,
      },
});
