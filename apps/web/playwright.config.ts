import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

/**
 * Two suites share this config:
 *
 * - visual (projects desktop-dark, mobile-dark, desktop-light, mobile-light):
 *   public pages against a bare Vite server, no API needed.
 * - e2e (project `e2e`, `bun run test:e2e`): the local stack. The API worker
 *   (wrangler, D1 local) on :3000 and Vite on :3002, both reused when already
 *   running (ruling R7). `e2e-setup` migrates nothing itself; it seeds the
 *   demo company via POST /dev/seed (idempotent) before the e2e tests run.
 *
 * Only the servers a run needs are started, so `--project=e2e` never boots the
 * visual server and the visual projects never boot the API.
 */
const visualBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3001";
const e2eBaseURL = process.env.E2E_BASE_URL ?? "http://localhost:3002";
const apiURL = process.env.E2E_API_URL ?? "http://localhost:3000";

/** Dummy API URL for public-route visual tests (no live server required). */
const visualTestEnv = {
  VITE_SERVER_URL: process.env.VITE_SERVER_URL ?? "http://127.0.0.1:8787",
  VITE_PUBLIC_URL: process.env.VITE_PUBLIC_URL ?? visualBaseURL,
};

/** Project names passed with --project (both `--project=x` and `--project x`). */
function requestedProjects(argv: string[]): string[] {
  const names: string[] = [];
  argv.forEach((arg, i) => {
    if (arg.startsWith("--project=")) names.push(arg.slice("--project=".length));
    else if (arg === "--project" && argv[i + 1]) names.push(argv[i + 1]!);
  });
  return names;
}

const requested = requestedProjects(process.argv);
const wantsE2E = requested.length === 0 || requested.some((p) => p.startsWith("e2e"));
const wantsVisual = requested.length === 0 || requested.some((p) => !p.startsWith("e2e"));

const visualServer: NonNullable<PlaywrightTestConfig["webServer"]> = {
  command: "bun run dev:bare -- --host 127.0.0.1 --port 3001",
  url: visualBaseURL,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  env: visualTestEnv,
};

const e2eServers: NonNullable<PlaywrightTestConfig["webServer"]> = [
  {
    // Local D1 migrations first, then the worker. Reused if already up.
    command: "bun run --cwd ../server dev:local:migrate && bun run --cwd ../server dev:local",
    url: apiURL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
  {
    command: "bun run dev:bare -- --port 3002 --strictPort",
    url: e2eBaseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_SERVER_URL: apiURL, VITE_PUBLIC_URL: e2eBaseURL },
  },
];

const servers = process.env.PLAYWRIGHT_SKIP_WEBSERVER
  ? undefined
  : [...(wantsE2E ? e2eServers : []), ...(wantsVisual ? [visualServer] : [])];

const visualUse = { baseURL: visualBaseURL };

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-dark",
      testDir: "./tests/visual",
      use: {
        ...devices["Desktop Chrome"],
        ...visualUse,
        viewport: { width: 1280, height: 720 },
        colorScheme: "dark",
      },
    },
    {
      name: "mobile-dark",
      testDir: "./tests/visual",
      use: {
        ...devices["Desktop Chrome"],
        ...visualUse,
        viewport: devices["iPhone 13"].viewport,
        userAgent: devices["iPhone 13"].userAgent,
        isMobile: true,
        hasTouch: true,
        colorScheme: "dark",
      },
    },
    {
      name: "desktop-light",
      testDir: "./tests/visual",
      use: {
        ...devices["Desktop Chrome"],
        ...visualUse,
        viewport: { width: 1280, height: 720 },
        colorScheme: "light",
      },
    },
    {
      name: "mobile-light",
      testDir: "./tests/visual",
      use: {
        ...devices["Desktop Chrome"],
        ...visualUse,
        viewport: devices["iPhone 13"].viewport,
        userAgent: devices["iPhone 13"].userAgent,
        isMobile: true,
        hasTouch: true,
        colorScheme: "light",
      },
    },
    {
      name: "e2e-setup",
      testDir: "./tests/e2e",
      testMatch: /global\.setup\.ts/,
      use: { baseURL: e2eBaseURL },
    },
    {
      name: "e2e",
      testDir: "./tests/e2e",
      testIgnore: /global\.setup\.ts/,
      dependencies: ["e2e-setup"],
      use: { ...devices["Desktop Chrome"], baseURL: e2eBaseURL },
    },
  ],
  webServer: servers,
});
