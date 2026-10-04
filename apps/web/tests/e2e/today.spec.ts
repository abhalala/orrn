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
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1")).toBeVisible();
}

/** The same procedure the screen calls, straight from the API with this browser's session. */
async function directToday(page: Page): Promise<TodayPayload> {
  const res = await page.context().request.get(`${API_URL}/trpc/dashboard.today`, { headers: { origin: WEB_ORIGIN } });
  expect(res.ok(), `dashboard.today returned ${res.status()}`).toBe(true);
  const body = await res.json();
  return body.result.data as TodayPayload;
}

/** Rewrites `dashboard.today` in every (batched) tRPC response. */
async function rewriteToday(page: Page, edit: (today: TodayPayload) => void) {
  await page.route("**/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(url.pathname.split("/trpc/")[1] ?? "").split(",");
    const index = procedures.indexOf("dashboard.today");
    if (index === -1) return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    const entry = Array.isArray(body) ? body[index] : body;
    const data = entry?.result?.data;
    if (data) edit((data.json ?? data) as TodayPayload);
    await route.fulfill({ response, json: body });
  });
}

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

const numbers = (page: Page) => page.getByTestId("today-numbers");
const tiles = (page: Page) => page.getByTestId("today-tiles");

for (const width of [390, 1280]) {
  test.describe(`owner at ${width}`, () => {
    test("KPI blocks, tiles and lists show exactly what dashboard.today returns", async ({ page }) => {
      await open(page, { width });
      const today = await directToday(page);
      expect(today.setup.dies && today.setup.bundles, "the seeded plant is not empty").toBe(true);

      const packed = numbers(page).getByTestId("kpi-packed");
      await expect(packed).toContainText(kgText(today.packedToday.weightG));
      await expect(packed).toContainText(`${countText(today.packedToday.bundles)} bundle`);

      const dispatched = numbers(page).getByTestId("kpi-dispatched");
      await expect(dispatched).toContainText(kgText(today.dispatchedToday.weightG));

      const inStockBundles = today.stock.available.bundles + today.stock.reserved.bundles;
      const inStockG = today.stock.available.weightG + today.stock.reserved.weightG;
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

      const openList = page.getByTestId("today-open-dispatches");
      for (const d of today.openDispatches) {
        const row = openList.getByRole("link", { name: new RegExp(d.code) });
        await expect(row).toHaveAttribute("href", `/dispatch/${d.id}`);
        await expect(row).toContainText(kgText(d.weightG));
      }
      if (today.openDispatches.length === 0) await expect(openList).toContainText("No open dispatches.");

      const sessions = page.getByTestId("today-sessions");
      for (const s of today.recentSessions) {
        await expect(sessions.getByRole("link", { name: new RegExp(s.code) })).toHaveAttribute("href", `/pack/${s.id}`);
      }
      if (today.recentSessions.length === 0) await expect(sessions).toContainText("Nothing packed yet today.");

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
      await expect(rows.last()).toContainText("so far");

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
    await open(page, { role: "operator", width: 390 });
    await expect(tiles(page).getByRole("link", { name: /Pack/ })).toBeVisible();
    await expect(tiles(page).getByRole("link", { name: /Dispatch/ })).toBeVisible();
    await expect(page.locator("[data-chart-kit]")).toHaveCount(0);
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
    await expect(checklist.getByRole("link", { name: "Pack your first bundles" })).toHaveAttribute("href", "/pack/new");
    await expect(checklist.getByRole("link", { name: "Connect a label printer" })).toHaveAttribute("href", "/printing");
    await expect(checklist).toContainText("0 of 4 done");
    await expect(numbers(page)).toHaveCount(0);
    await expect(page.getByTestId("today-open-dispatches")).toHaveCount(0);
    await expect(page.locator("[data-chart-kit]")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, "main#main");
  });

  test("a viewer in an empty plant sees the steps without links", async ({ page }) => {
    await rewriteToday(page, (today) => {
      today.setup = { dies: true, customers: false, bundles: false, printers: false };
    });
    await open(page, { role: "viewer", width: 390 });
    const checklist = page.getByTestId("today-start-here");
    await expect(checklist).toContainText("1 of 4 done");
    await expect(checklist.getByRole("link")).toHaveCount(0);
  });
});

test.describe("states", () => {
  test("a failed load says so and Try again recovers", async ({ page }) => {
    let fail = true;
    await page.route("**/trpc/**", async (route) => {
      const procedures = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
      if (fail && procedures.includes("dashboard.today")) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "x" } }) });
      }
      return route.continue();
    });
    await open(page, { width: 390 });
    await expect(page.getByText("Today's numbers didn't load")).toBeVisible({ timeout: 15_000 });
    // One message, in the screen's words: the global error toast stays quiet.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Try again" }).first().click();
    await expect(numbers(page).getByTestId("kpi-packed")).toBeVisible();
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

  test("keyboard: Tab walks tiles, then the dispatch list, with a visible focus ring", async ({ page }) => {
    await open(page, { width: 1280 });
    const today = await directToday(page);
    const tileLinks = tiles(page).getByRole("link");
    await tileLinks.first().focus();
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
