import { assertWorktreePorts, resolveDevPorts, type PortNeed } from "@orrn/server/lib/devPorts";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

/**
 * Two suites share this config:
 *
 * - visual (projects desktop-dark, mobile-dark, desktop-light, mobile-light):
 *   public pages against a bare Vite server, no API needed.
 * - e2e (project `e2e`, `bun run test:e2e`): the local stack. The API worker
 *   (wrangler, D1 local) and Vite, both reused when already running (ruling R7).
 *   `e2e-setup` migrates nothing itself; it seeds the demo company via
 *   POST /dev/seed (idempotent) before the e2e tests run.
 *
 * Ports are per worktree, so up to ten worktrees can run these suites at once:
 * E2E_API_PORT / E2E_WEB_PORT (or E2E_API_URL / E2E_BASE_URL) for the stack and
 * VISUAL_WEB_PORT (or PLAYWRIGHT_BASE_URL) for the public-page suite, and
 * E2E_WORKERS caps the workers per run (unset: Playwright's default). Defaults
 * are today's single-checkout ports, API 3000, web 3002, visual 3001. In a
 * worktree, `source .wt-ports.env` first: with no ports in the environment, or
 * with another worktree's (ORRN_WT_ROOT), this config refuses to run rather than
 * reuse another worktree's servers.
 * See packages/server/src/lib/devPorts.ts.
 *
 * Only the servers a run needs are started, so `--project=e2e` never boots the
 * visual server and the visual projects never boot the API.
 */
const ports = resolveDevPorts(process.env);
const visualBaseURL = ports.visualURL;
const e2eBaseURL = ports.webURL;
const apiURL = ports.apiURL;

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

const needs: PortNeed[] = [...(wantsE2E ? (["api", "web"] as const) : []), ...(wantsVisual ? (["visual"] as const) : [])];
assertWorktreePorts(process.env, import.meta.dirname, needs);

/** Env handed to every server this config starts, so their scripts see the same ports. */
const portEnv = {
  E2E_API_PORT: String(ports.apiPort),
  E2E_WEB_PORT: String(ports.webPort),
  E2E_API_URL: ports.apiURL,
  E2E_BASE_URL: ports.webURL,
};

/**
 * Playwright's default is one worker per two cores, per run. Several worktrees running at once
 * multiply that and push first-load pages past the 5 s expect timeout (blank page, no h1), so
 * .wt-ports.env sets E2E_WORKERS=3 (docs/LOCAL_DEV.md). `--workers` on the command line still wins.
 */
const workersFromEnv = Number(process.env.E2E_WORKERS);
const e2eWorkers = Number.isInteger(workersFromEnv) && workersFromEnv > 0 ? workersFromEnv : undefined;

const visualServer: NonNullable<PlaywrightTestConfig["webServer"]> = {
  command: `bun run dev:bare -- --host 127.0.0.1 --port ${ports.visualPort} --strictPort`,
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
    env: portEnv,
  },
  {
    command: `bun run dev:bare -- --port ${ports.webPort} --strictPort`,
    url: e2eBaseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { ...portEnv, VITE_SERVER_URL: apiURL, VITE_PUBLIC_URL: e2eBaseURL },
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
  workers: process.env.CI ? 1 : e2eWorkers,
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
