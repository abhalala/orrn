import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Today (`/today`, plan Task 19): KPI blocks from `dashboard.today`, the
 * role-aware action tiles, open dispatches and today's packing sessions,
 * "Start here" for an empty plant, and the two charts (90-day packed vs
 * dispatched, stock age) only for `analytics.view` roles. Needs the local
 * stack (API + web on this worktree's ports, seeded accounts).
 */

type Scheme = "light" | "dark";
type Totals = { bundles: number; weightG: number };
type TodayPayload = {
  timezone: string;
  date: string;
  packedToday: Totals;
  dispatchedToday: { dispatches: number; weightG: number };
  stock: Record<"available" | "reserved" | "dispatched" | "void", Totals>;
  openDispatchCount: number;
  openDispatches: { id: string; code: string; status: "draft" | "reserved"; customerName: string; bundles: number; weightG: number }[];
  recentSessions: { id: string; code: string; dieLabel: string; bundles: number; weightG: number; createdAt: string }[];
  failedPrintJobs: number;
  setup: { dies: boolean; customers: boolean; bundles: boolean; printers: boolean };
};

const kgText = (grams: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(grams / 1000);
const countText = (n: number) => n.toLocaleString("en-IN");

async function open(page: Page, opts: { role?: LocalRole; width: number; scheme?: Scheme; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto("/today");
  // The first page of a cold Vite dev server can take longer than 5 s at high machine load.
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main#main h1")).toBeVisible();
}

/** Top edge of each tile's title block: tiles in one row must line up whatever their hint length. */
const tileTitleTops = (page: Page) =>
  tiles(page)
    .locator("[data-slot='action-tile'] > span:nth-child(2)")
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));

/** The same procedure the screen calls, straight from the API with this browser's session. */
async function directToday(page: Page): Promise<TodayPayload> {
  const res = await page.context().request.get(`${API_URL}/trpc/dashboard.today`, { headers: { origin: WEB_ORIGIN } });
  expect(res.ok(), `dashboard.today returned ${res.status()}`).toBe(true);
  const body = await res.json();
  return body.result.data as TodayPayload;
}

/** The tRPC procedures in a (batched) request URL. */
const proceduresOf = (url: string) =>
  decodeURIComponent(new URL(url).pathname.split("/trpc/")[1] ?? "").split(",");

/**
 * Records the `dashboard.today` payload the page itself received, so the
 * screen is compared with exactly what it was given (a direct call can race
 * other specs that create dispatches on the shared seed).
 */
async function watchToday(page: Page) {
  const seen: { last: TodayPayload | null } = { last: null };
  page.on("response", async (response) => {
    const procedures = proceduresOf(response.url());
    const index = procedures.indexOf("dashboard.today");
    if (index === -1 || !response.ok()) return;
    try {
      const body = await response.json();
      const entry = Array.isArray(body) ? body[index] : body;
      const data = entry?.result?.data;
      if (data) seen.last = (data.json ?? data) as TodayPayload;
    } catch {
      /* not JSON */
    }
  });
  return seen;
}

/**
 * The payload the page rendered. The response handler reads the body
 * asynchronously, so the blocks can be on screen a moment before it lands.
 */
async function receivedToday(seen: { last: TodayPayload | null }): Promise<TodayPayload> {
  await expect
    .poll(() => seen.last !== null, { message: "the page received dashboard.today", timeout: 10_000 })
    .toBe(true);
  return seen.last!;
}

/** Fires the browser's visibilitychange, which makes React Query refetch stale queries (as on returning to the tab). */
const wakeQueries = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

const serverError = { status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "x" } }) };

/** Rewrites one procedure's result in every (batched) tRPC response. */
async function rewriteProcedure<T>(page: Page, procedure: string, edit: (data: T) => void) {
  await page.route("**/trpc/**", async (route) => {
    const index = proceduresOf(route.request().url()).indexOf(procedure);
    if (index === -1) return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    const entry = Array.isArray(body) ? body[index] : body;
    const data = entry?.result?.data;
    if (data) edit((data.json ?? data) as T);
    await route.fulfill({ response, json: body });
  });
}

/** Rewrites `dashboard.today` in every (batched) tRPC response. */
const rewriteToday = (page: Page, edit: (today: TodayPayload) => void) =>
  rewriteProcedure<TodayPayload>(page, "dashboard.today", edit);

async function blockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, help: v.help, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
}

// Route handlers (rewrites, failures) may still be in flight when a test ends; let them go quietly.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const numbers = (page: Page) => page.getByTestId("today-numbers");
const tiles = (page: Page) => page.getByTestId("today-tiles");

for (const width of [390, 1280]) {
  test.describe(`owner at ${width}`, () => {
    test("KPI blocks, tiles and lists show exactly what dashboard.today returns", async ({ page }) => {
      const seen = await watchToday(page);
      await open(page, { width });
      await expect(numbers(page)).toBeVisible();
      const today = await receivedToday(seen);
      // The page's payload is the server's: same procedure, same session.
      const direct = await directToday(page);
      expect(today.setup).toEqual(direct.setup);
      expect(today.date).toBe(direct.date);
      expect(today.setup.dies && today.setup.bundles, "the seeded plant is not empty").toBe(true);

      const packed = numbers(page).getByTestId("kpi-packed");
      await expect(packed).toContainText(kgText(today.packedToday.weightG));
      await expect(packed).toContainText(
        today.packedToday.bundles > 0 ? `${countText(today.packedToday.bundles)} bundle` : "No bundles yet",
      );

      const dispatched = numbers(page).getByTestId("kpi-dispatched");
      await expect(dispatched).toContainText(kgText(today.dispatchedToday.weightG));

      // In stock = available only, the Stock screen's figure (held bundles are not counted).
      const inStockBundles = today.stock.available.bundles;
      const inStockG = today.stock.available.weightG;
      const stock = numbers(page).getByTestId("kpi-stock");
      await expect(stock).toContainText(countText(inStockBundles));
      await expect(stock).toContainText(kgText(inStockG));

      // Action tiles in spec order; Dispatch carries the uncapped open count.
      const links = tiles(page).getByRole("link");
      await expect(links).toHaveCount(4);
      await expect(links.nth(0)).toContainText("Pack");
      await expect(links.nth(0)).toHaveAttribute("href", "/pack/new");
      await expect(links.nth(1)).toContainText("Dispatch");
      await expect(links.nth(1)).toContainText(
        today.openDispatchCount > 0 ? `${today.openDispatchCount} open` : "None open",
      );
      await expect(links.nth(2)).toContainText("Stock");
      await expect(links.nth(3)).toContainText("Guides");
      // "Start a packing session" wraps on a phone; titles in a row still line up.
      const tops = await tileTitleTops(page);
      if (width >= 768) expect(new Set(tops).size, `title tops ${tops}`).toBe(1);
      else expect([tops[0], tops[2]], `title tops ${tops}`).toEqual([tops[1], tops[3]]);

      const openList = page.getByTestId("today-open-dispatches");
      for (const d of today.openDispatches) {
        const row = openList.getByRole("link", { name: new RegExp(d.code) });
        await expect(row).toHaveAttribute("href", `/dispatch/${d.id}`);
        await expect(row).toContainText(kgText(d.weightG));
      }
      if (today.openDispatches.length === 0) await expect(openList).toContainText("No open dispatches");

      const sessions = page.getByTestId("today-sessions");
      for (const s of today.recentSessions) {
        await expect(sessions.getByRole("link", { name: new RegExp(s.code) })).toHaveAttribute("href", `/pack/${s.id}`);
      }
      if (today.recentSessions.length === 0) await expect(sessions).toContainText("Nothing packed yet today");

      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main#main");
    });

    test("owner sees the 90-day trend (today so far) and stock age, each with a table", async ({ page }) => {
      await open(page, { width });
      const trend = page.getByTestId("today-trend");
      await trend.scrollIntoViewIfNeeded();
      await expect(trend.getByRole("heading", { name: "Packed and dispatched" })).toBeVisible();
      await expect(trend.locator("[data-slot='legend-swatch']")).toHaveCount(2);
      await trend.getByRole("button", { name: "Show table" }).click();
      const rows = trend.getByRole("table").locator("tbody tr");
      await expect(rows).toHaveCount(90);
      // Newest first: today so far sits right under Hide table.
      await expect(rows.first()).toContainText("so far");
      await expect(rows.nth(1)).not.toContainText("so far");

      const ageing = page.getByTestId("today-ageing");
      await expect(ageing.getByRole("heading", { name: "Stock age" })).toBeVisible();
      await ageing.getByRole("button", { name: "Show table" }).click();
      const ageRows = ageing.getByRole("table").locator("tbody tr");
      await expect(ageRows).toHaveCount(4);
      await expect(ageRows.first()).toContainText("0-15 days");
      await expect(ageRows.last()).toContainText("Over 60 days");

      await expectNoHorizontalScroll(page);
    });
  });
}

test.describe("roles", () => {
  test("viewer sees only the numbers: no action tiles (no Pack tile) and no charts", async ({ page }) => {
    const analytics: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("analytics.")) analytics.push(r.url());
    });
    await open(page, { role: "viewer", width: 390 });
    await expect(numbers(page).getByTestId("kpi-packed")).toBeVisible();
    await expect(page.getByTestId("today-open-dispatches")).toBeVisible();
    // Spec section 3 Today: "Viewers see no action tiles, only numbers".
    await expect(tiles(page)).toHaveCount(0);
    await expect(page.locator("main#main [data-slot='action-tile']")).toHaveCount(0);
    await expect(page.locator("[data-chart-kit]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Trends" })).toHaveCount(0);
    expect(analytics, "viewers never call analytics").toEqual([]);
  });

  test("operator packs and scans into dispatches but sees no charts", async ({ page }) => {
    const analytics: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("analytics.")) analytics.push(r.url());
    });
    await open(page, { role: "operator", width: 390 });
    await expect(tiles(page).getByRole("link", { name: /Pack/ })).toBeVisible();
    await expect(tiles(page).getByRole("link", { name: /Dispatch/ })).toBeVisible();
    await expect(numbers(page).getByTestId("kpi-packed")).toBeVisible();
    await expect(page.locator("[data-chart-kit]")).toHaveCount(0);
    expect(analytics, "the floor never calls analytics").toEqual([]);
  });

  test("office gets three tiles in one row, with no empty fourth column", async ({ page }) => {
    // The seed has no office account: an owner session whose auth.me says office. The role
    // only decides which tiles render here; the server still answers as the owner.
    await rewriteProcedure<{ company: { role: string } | null }>(page, "auth.me", (me) => {
      if (me.company) me.company.role = "office";
    });
    await open(page, { width: 1280 });
    const links = tiles(page).getByRole("link");
    await expect(links).toHaveCount(3);
    const boxes = await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
    const row = await tiles(page).locator("ul").evaluate((el) => el.getBoundingClientRect().width);
    // Three equal columns fill the row: the last tile ends at the row's right edge.
    expect(Math.abs(boxes[2]!.right - boxes[0]!.left - row)).toBeLessThan(2);
  });
});

test.describe("empty plant", () => {
  test("shows the Start here checklist instead of empty widgets", async ({ page }) => {
    await rewriteToday(page, (today) => {
      today.setup = { dies: false, customers: false, bundles: false, printers: false };
      today.packedToday = { bundles: 0, weightG: 0 };
      today.openDispatches = [];
      today.recentSessions = [];
    });
    await open(page, { width: 390 });
    const checklist = page.getByTestId("today-start-here");
    await expect(checklist.getByRole("heading", { name: "Start here" })).toBeVisible();
    const steps = checklist.getByRole("listitem");
    await expect(steps).toHaveCount(4);
    await expect(checklist.getByRole("link", { name: "Add a die" })).toHaveAttribute("href", "/dies");
    await expect(checklist.getByRole("link", { name: "Add a customer" })).toHaveAttribute("href", "/customers");
    // Packing starts by picking a die, so it waits for one instead of linking to an empty picker.
    await expect(checklist.getByRole("link", { name: "Pack your first bundles" })).toHaveCount(0);
    await expect(steps.nth(2)).toContainText("After a die is added");
    await expect(checklist.getByRole("link", { name: "Connect a label printer" })).toHaveAttribute("href", "/printing");
    await expect(checklist).toContainText("0 of 4 done");
    await expect(checklist).toContainText("A few things to set up before the floor starts using orrn.");
    await expect(numbers(page)).toHaveCount(0);
    await expect(page.getByTestId("today-open-dispatches")).toHaveCount(0);
    await expect(page.locator("[data-chart-kit]")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, "main#main");
  });

  test("once a die exists, Pack your first bundles links to the pack screen", async ({ page }) => {
    await rewriteToday(page, (today) => {
      today.setup = { dies: true, customers: false, bundles: false, printers: false };
    });
    await open(page, { width: 390 });
    const checklist = page.getByTestId("today-start-here");
    await expect(checklist.getByRole("link", { name: "Pack your first bundles" })).toHaveAttribute("href", "/pack/new");
    await expect(checklist).toContainText("1 of 4 done");
  });

  test("a viewer in an empty plant sees the steps without links", async ({ page }) => {
    await rewriteToday(page, (today) => {
      today.setup = { dies: true, customers: false, bundles: false, printers: false };
    });
    await open(page, { role: "viewer", width: 390 });
    const checklist = page.getByTestId("today-start-here");
    await expect(checklist).toContainText("1 of 4 done");
    await expect(checklist.getByRole("link")).toHaveCount(0);
    // The line under the title tells a viewer what they are waiting for.
    await expect(checklist).toContainText("Your admin is setting orrn up.");
  });
});

test.describe("states", () => {
  test("a failed load says so and Try again recovers", async ({ page }) => {
    let fail = true;
    await page.route("**/trpc/**", async (route) => {
      const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
      if (fail && procedures.includes("dashboard.today")) return route.fulfill(serverError);
      return route.continue();
    });
    await open(page, { width: 390 });
    await expect(page.getByText("Today's numbers didn't load")).toBeVisible({ timeout: 15_000 });
    // One message, in the screen's words: the global error toast stays quiet.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    // The tiles still work; Dispatch has no count to show, so it reads a plain line (titles stay aligned).
    await expect(tiles(page).getByRole("link", { name: /Dispatch/ })).toContainText("Load a truck");
    const tops = await tileTitleTops(page);
    expect([tops[0], tops[2]], `title tops ${tops}`).toEqual([tops[1], tops[3]]);
    fail = false;
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expect(numbers(page).getByTestId("kpi-packed")).toBeVisible();
  });

  test("a failed background refresh keeps the numbers on screen and says so quietly", async ({ page }) => {
    let failToday = false;
    let failedCalls = 0;
    await page.route("**/trpc/**", async (route) => {
      if (failToday && proceduresOf(route.request().url()).includes("dashboard.today")) {
        failedCalls += 1;
        return route.fulfill(serverError);
      }
      return route.continue();
    });
    await open(page, { width: 390 });
    const packed = numbers(page).getByTestId("kpi-packed");
    await expect(packed).toBeVisible();
    const before = await packed.innerText();

    // The next refresh fails (plant Wi-Fi with no backhaul): after its retries the numbers stay.
    failToday = true;
    await wakeQueries(page);
    const notice = page.getByTestId("today-refresh-failed");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    expect(failedCalls, "the refresh and its retries all failed").toBeGreaterThanOrEqual(1);
    await expect(notice).toContainText(/Couldn't refresh\. Showing the numbers from \d\d:\d\d\./);
    await expect(packed).toBeVisible();
    expect(await packed.innerText()).toBe(before);
    await expect(page.getByTestId("today-open-dispatches")).toBeVisible();
    await expect(page.getByTestId("today-trend")).toBeVisible();
    await expect(page.getByText("Today's numbers didn't load")).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    // Dispatch keeps its last known open count.
    await expect(tiles(page).getByRole("link", { name: /Dispatch/ })).not.toContainText("Load a truck");

    failToday = false;
    await notice.getByRole("button", { name: "Try again" }).click();
    await expect(notice).toHaveCount(0);
    await expect(packed).toBeVisible();
  });

  test("the trend's today so far always equals the KPI blocks, and charts keep their data when a refresh fails", async ({
    page,
  }) => {
    let packedG = 98_765_400;
    let failAnalytics = false;
    let trendCalls = 0;
    await page.route("**/trpc/**", async (route) => {
      const procedures = proceduresOf(route.request().url());
      if (procedures.some((p) => p.startsWith("analytics."))) {
        trendCalls += procedures.includes("analytics.trends") ? 1 : 0;
        if (failAnalytics) return route.fulfill(serverError);
        return route.continue();
      }
      const index = procedures.indexOf("dashboard.today");
      if (index === -1) return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      const entry = Array.isArray(body) ? body[index] : body;
      const data = entry?.result?.data;
      if (data) ((data.json ?? data) as TodayPayload).packedToday.weightG = packedG;
      await route.fulfill({ response, json: body });
    });
    await open(page, { width: 1280 });
    await expect(numbers(page).getByTestId("kpi-packed")).toContainText("98,765.4");
    const trend = page.getByTestId("today-trend");
    await trend.getByRole("button", { name: "Show table" }).click();
    const soFar = trend.getByRole("table").locator("tbody tr").first();
    await expect(soFar).toContainText("so far");
    await expect(soFar).toContainText("98,765.4 kg");

    // More gets packed; the charts' own refresh fails. The so far row follows the blocks at once
    // and the charts keep their last data instead of turning into an error card.
    failAnalytics = true;
    const callsBefore = trendCalls;
    packedG = 99_000_100;
    await wakeQueries(page);
    await expect(numbers(page).getByTestId("kpi-packed")).toContainText("99,000.1");
    await expect(soFar).toContainText("99,000.1 kg");
    // The changed numbers made the trend refetch; wait for it and its retries to fail.
    await expect.poll(() => trendCalls - callsBefore, { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
    await page.waitForTimeout(500);
    await expect(page.getByText("This chart didn't load")).toHaveCount(0);
    await expect(soFar).toContainText("99,000.1 kg");
    await expect(page.getByTestId("today-ageing").getByRole("button", { name: /table/ })).toBeVisible();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });

  test("a quiet 90 days shows the trend's own empty state, without a legend or a table of zeros", async ({ page }) => {
    await rewriteProcedure<{ date: string; packedKgG: number; dispatchedKgG: number }[]>(page, "analytics.trends", (days) => {
      for (const d of days) {
        d.packedKgG = 0;
        d.dispatchedKgG = 0;
      }
    });
    await rewriteToday(page, (today) => {
      today.packedToday = { bundles: 0, weightG: 0 };
      today.dispatchedToday = { dispatches: 0, weightG: 0 };
    });
    await open(page, { width: 1280 });
    const trend = page.getByTestId("today-trend");
    await expect(trend).toContainText("Nothing packed or dispatched in 90 days");
    await expect(trend.locator("[data-slot='legend-swatch']")).toHaveCount(0);
    await expect(trend.getByRole("button", { name: "Show table" })).toHaveCount(0);
    await expect(numbers(page).getByTestId("kpi-packed")).toContainText("No bundles yet");
  });

  test("a chart that fails to load says so on its card, with no global toast", async ({ page }) => {
    await page.route("**/trpc/**", async (route) => {
      if (proceduresOf(route.request().url()).includes("analytics.trends")) return route.fulfill(serverError);
      return route.continue();
    });
    await open(page, { width: 1280 });
    const trend = page.getByTestId("today-trend");
    await expect(trend).toContainText("This chart didn't load", { timeout: 20_000 });
    await expect(trend.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(numbers(page).getByTestId("kpi-packed")).toBeVisible();
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  });

  test("if the charts' code can't load, the numbers and lists stay and the card says how to recover", async ({
    page,
  }) => {
    await page.route(/today-charts/, (route) => route.abort());
    await open(page, { width: 1280 });
    await expect(numbers(page).getByTestId("kpi-packed")).toBeVisible();
    await expect(page.getByTestId("today-open-dispatches")).toBeVisible();
    const card = page.getByTestId("today-charts-failed");
    await expect(card).toContainText("Charts didn't load");
    await expect(card.getByRole("button", { name: "Reload page" })).toBeVisible();
  });

  test("empty lists offer the next step to people who can take it", async ({ page }) => {
    await rewriteToday(page, (today) => {
      today.openDispatches = [];
      today.recentSessions = [];
    });
    await open(page, { width: 390 });
    await expect(page.getByTestId("today-open-dispatches").getByRole("link", { name: "New dispatch" })).toHaveAttribute(
      "href",
      "/dispatch/new",
    );
    await expect(
      page.getByTestId("today-sessions").getByRole("link", { name: "New packing session" }),
    ).toHaveAttribute("href", "/pack/new");
  });

  test("failed labels today show a print problem with a way to Printing", async ({ page }) => {
    await rewriteToday(page, (today) => {
      today.failedPrintJobs = 3;
    });
    await open(page, { width: 1280 });
    const notice = page.getByTestId("today-print-problems");
    await expect(notice).toContainText("3 labels didn't print");
    await expect(notice.getByRole("link", { name: "Open printing" })).toHaveAttribute("href", "/printing");
  });
});

test.describe("accessibility", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const width of [390, 1280]) {
      test(`owner ${scheme} ${width}: one h1, landmarks, axe has no serious or critical issues`, async ({ page }) => {
        await open(page, { width, scheme });
        await expect(page.getByTestId("today-trend")).toBeVisible();
        await expect(page.locator("main#main h1")).toHaveCount(1);
        await expect(page.getByRole("heading", { level: 2, name: "Open dispatches" })).toBeVisible();
        expect(await blockingAxeViolations(page)).toEqual([]);
      });
    }
  }

  for (const { width, height } of [
    { width: 820, height: 1180 },
    { width: 1024, height: 768 },
  ]) {
    test(`owner ${width}x${height}: stacked layout, no overflow or clipping, axe clean`, async ({ page }) => {
      await open(page, { width, height });
      const trend = page.getByTestId("today-trend");
      const ageing = page.getByTestId("today-ageing");
      await expect(trend).toBeVisible();
      await expect(ageing.locator("svg[data-slot='chart-plot']")).toBeVisible();
      // With the sidebar out (1024) the content column is ~690 px: charts stack full width,
      // so stock age keeps every age label under its bar.
      const [t, a] = [await trend.boundingBox(), await ageing.boundingBox()];
      expect(Math.abs(t!.x - a!.x), "charts are stacked").toBeLessThan(2);
      expect(Math.abs(t!.width - a!.width), "charts are full width").toBeLessThan(2);
      const labels = (await ageing.locator("svg[data-slot='chart-plot'] text").allTextContents()).map((l) => l.trim());
      for (const label of ["0-15", "16-30", "31-60", "60+"]) expect(labels).toContain(label);
      // Lists stack too, and the KPI row is the hero then the pair.
      const [d, s] = [
        await page.getByTestId("today-open-dispatches").boundingBox(),
        await page.getByTestId("today-sessions").boundingBox(),
      ];
      expect(Math.abs(d!.x - s!.x), "lists are stacked").toBeLessThan(2);
      const hero = await numbers(page).getByTestId("kpi-packed").boundingBox();
      const pair = await numbers(page).getByTestId("kpi-dispatched").boundingBox();
      expect(pair!.y, "the pair sits under the hero").toBeGreaterThan(hero!.y + hero!.height - 1);
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main#main");
      expect(await blockingAxeViolations(page)).toEqual([]);
    });
  }

  test("phone: the hero is full width with the pair side by side, and the first tiles show above the tab bar", async ({
    page,
  }) => {
    await open(page, { role: "operator", width: 375, height: 812 });
    const hero = await numbers(page).getByTestId("kpi-packed").boundingBox();
    const dispatched = await numbers(page).getByTestId("kpi-dispatched").boundingBox();
    const stock = await numbers(page).getByTestId("kpi-stock").boundingBox();
    expect(Math.abs(dispatched!.y - stock!.y), "pair on one row").toBeLessThan(2);
    expect(dispatched!.y).toBeGreaterThan(hero!.y + hero!.height - 1);
    const firstTile = await tiles(page).getByRole("link").first().boundingBox();
    const tabBarTop = await page.locator("[data-slot='tab-bar']").first().evaluate(
      (el) => el.getBoundingClientRect().top,
    );
    expect(firstTile!.y, "first tile row starts above the tab bar").toBeLessThan(tabBarTop);
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, "main#main");
  });

  test("keyboard: Tab walks tiles, then the dispatch list, with a visible focus ring", async ({ page }) => {
    const seen = await watchToday(page);
    await open(page, { width: 1280 });
    await expect(numbers(page)).toBeVisible();
    const today = await receivedToday(seen);
    const tileLinks = tiles(page).getByRole("link");
    await tileLinks.first().focus();
    const ring = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const cs = el ? getComputedStyle(el) : null;
        return cs ? { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) } : { style: "none", width: 0 };
      });
    const tileRing = await ring();
    expect(tileRing.style, "focused tile shows a ring").not.toBe("none");
    expect(tileRing.width).toBeGreaterThanOrEqual(2);
    const focused = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    const order: string[] = [await focused()];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      order.push(await focused());
    }
    expect(order[0]).toContain("Pack");
    expect(order[1]).toContain("Dispatch");
    expect(order[2]).toContain("Stock");
    expect(order[3]).toContain("Guides");
    if (today.failedPrintJobs > 0) {
      expect(order[4]).toBe("Open printing");
      await page.keyboard.press("Tab");
      order.push(await focused());
    }
    expect(order.at(-1)).toBe("All dispatches");
    await page.keyboard.press("Tab");
    if (today.openDispatches.length > 0) expect(await focused()).toContain(today.openDispatches[0]!.code);
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? getComputedStyle(el).outlineStyle : "none";
    });
    expect(outline, "focused row shows a ring").not.toBe("none");
  });

  test("Hindi: the screen reads in Devanagari and keeps Latin digits", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem("orrn.locale", "hi");
      } catch {
        /* storage blocked */
      }
    });
    await open(page, { width: 390 });
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(numbers(page)).toContainText("आज पैक हुआ");
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, "main#main");
  });
});
