import { readFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, request as pwRequest, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { localPassword, signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Reports (W4-ANALYTICS): `/reports`, `/reports/production` (the press report + recovery by die /
 * press / shift), `/reports/die-life`, `/reports/stock-age`, `/reports/orders`, the die card's
 * life header and Today's "Stock older than 90 days" tile, against the local seed (PR-8 logged
 * today on P1 = the worked run, 75.5 %; copy 13090-1 with a 60,000 kg life; seed bundles and
 * orders). Read-only: nothing here writes, so it never meets another spec's data.
 *
 * Roles: office (reports.read + order.price), viewer (reports.read, no rates), operator (neither:
 * refused), owner (Today tile). Every figure the page shows is compared with the server's answer.
 */

const WIDTHS = [375, 820, 1280] as const;

type Api = {
  q<T>(path: string, input?: unknown): Promise<T>;
  status(path: string, input?: unknown): Promise<number>;
  dispose(): Promise<void>;
};

async function apiAs(role: LocalRole): Promise<Api> {
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  const login = await ctx.post(`${API_URL}/api/auth/sign-in/email`, { data: { email: `${role}@orrn.local`, password: localPassword() } });
  expect(login.ok(), `sign-in as ${role} returned ${login.status()}`).toBe(true);
  const url = (path: string, input?: unknown) => `${API_URL}/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`}`;
  return {
    async q<T>(path: string, input?: unknown) {
      const res = await ctx.get(url(path, input));
      expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()).result.data as T;
    },
    async status(path: string, input?: unknown) {
      return (await ctx.get(url(path, input))).status();
    },
    dispose: () => ctx.dispose(),
  };
}

async function openAs(browser: Browser, role: LocalRole, width: number, path: string, opts: { locale?: "hi" } = {}): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 800 : 900 }, colorScheme: "light", reducedMotion: "reduce", acceptDownloads: true });
  const page = await context.newPage();
  if (opts.locale) await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), opts.locale);
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 25_000 });
  return { page, context };
}

async function axeSerious(page: Page) {
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

/** Click a CSV button and return the file's name and lines. */
async function csvFrom(page: Page, button: ReturnType<Page["getByRole"]>) {
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const text = await readFile((await download.path())!, "utf8");
  return { name: download.suggestedFilename(), lines: text.trim().split("\n") };
}

type Recovery = { rows: { key: string; recoveryPct: string | null }[]; totals: { runs: number; recoveryPct: string | null } };
type DieLife = { items: { dieInstanceId: string; code: string; usedPct: string | null; state: string }[] };
type StockAge = { totals: { bundles: number; kgG: number }; over90: { bundles: number }; rows: { customerId: string | null }[] };
type Orders = { rows: { key: string }[]; sum: { orders: number }; ratesAllowed: boolean };

let office: Api;
let day: string;

test.beforeAll(async () => {
  office = await apiAs("office");
  day = (await office.q<{ productionDay: string }>("press.summary", {})).productionDay;
});
test.afterAll(async () => {
  await office?.dispose();
});

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test("index and production: the press report, recovery by die and press, CSV, axe", async ({ browser }) => {
      const { page, context } = await openAs(browser, "office", width, "/reports");
      await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
      const list = page.getByTestId("reports-list");
      for (const name of ["Production", "Die life", "Stock age", "Order book"]) await expect(list.getByRole("link", { name: new RegExp(name) })).toBeVisible();
      expect(await axeSerious(page)).toEqual([]);

      await list.getByRole("link", { name: /Production/ }).click();
      await expect(page.getByRole("heading", { name: "Production report", level: 1 })).toBeVisible();
      await page.goto(`/reports/production?from=${day}&to=${day}`);
      await expect(page.getByTestId("press-report-table").locator('tbody tr[data-run="PR-8"]')).toBeVisible();
      const byDie = await office.q<Recovery>("analytics.recovery", { from: day, to: day, groupBy: "die" });
      expect(byDie.totals.runs).toBeGreaterThan(0);
      const summary = page.getByTestId("recovery-summary");
      await expect(summary.getByTestId("recovery-totals")).toContainText(byDie.totals.recoveryPct!);
      await expect(summary.getByTestId("recovery-table").locator("tbody tr")).toHaveCount(byDie.rows.length);

      // Group by press: one row per line, the same total.
      await summary.getByRole("radio", { name: "Press" }).click();
      await expect(page).toHaveURL(/group=press/);
      const byPress = await office.q<Recovery>("analytics.recovery", { from: day, to: day, groupBy: "press" });
      await expect(summary.getByTestId("recovery-table").locator("tbody tr")).toHaveCount(byPress.rows.length);
      await expect(summary.getByTestId("recovery-totals")).toContainText(byPress.totals.recoveryPct!);

      const csv = await csvFrom(page, summary.getByRole("button", { name: "Download CSV" }));
      expect(csv.name).toBe(`recovery-${day}.csv`);
      expect(csv.lines[0]).toBe('Press,Runs,Billets kg,Good kg,"Butt, ends and rejects kg",Recovery %');
      expect(csv.lines.at(-1)).toMatch(new RegExp(`^Total,${byPress.totals.runs},.*,${byPress.totals.recoveryPct!.replace(".", "\\.")}$`));
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);
      await context.close();
    });

    test("die life, stock age and the order book render the server's figures, with CSV", async ({ browser }) => {
      const life = await office.q<DieLife>("analytics.dieLife", { withLife: true, includeRetired: false, limit: 100, offset: 0 });
      const tee = life.items.find((i) => i.code === "13090-1")!;
      expect(tee).toBeTruthy();
      const { page, context } = await openAs(browser, "office", width, "/reports/die-life");
      const row = page.getByTestId("die-life-table").locator('tbody tr[data-copy="13090-1"]');
      await expect(row).toBeVisible();
      await expect(row).toContainText(`${tee.usedPct} % used`);
      const lifeCsv = await csvFrom(page, page.getByRole("button", { name: "Download CSV" }));
      expect(lifeCsv.name).toBe("die-life.csv");
      expect(lifeCsv.lines[0]).toBe("Die copy,Section,Status,Life kg,Pressed kg,Used,Left kg,Runs,Last run");
      expect(lifeCsv.lines).toHaveLength(life.items.length + 1);
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);

      const age = await office.q<StockAge>("analytics.stockAge", {});
      await page.goto("/reports/stock-age");
      await expect(page.getByRole("heading", { name: "Stock age", level: 1 })).toBeVisible();
      if (age.totals.bundles > 0) {
        await expect(page.getByTestId("stock-age-table").locator("tbody tr")).toHaveCount(age.rows.length);
        await expect(page.getByTestId("stock-age-totals")).toContainText(`${age.totals.bundles} bundle`);
        const ageCsv = await csvFrom(page, page.getByRole("button", { name: "Download CSV" }));
        expect(ageCsv.name).toMatch(/^stock-age-\d{4}-\d{2}-\d{2}\.csv$/);
        expect(ageCsv.lines.at(-1)).toMatch(new RegExp(`^Total,.*,${age.totals.bundles}$`));
        await page.getByRole("radio", { name: "Plant stock only" }).click();
        await expect(page).toHaveURL(/plant=true/);
      }
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);

      const orders = await office.q<Orders>("analytics.orders", { groupBy: "month" });
      await page.goto("/reports/orders?group=month");
      await expect(page.getByRole("heading", { name: "Order book report", level: 1 })).toBeVisible();
      await expect(page.getByTestId("orders-report-table").locator("tbody tr")).toHaveCount(orders.rows.length);
      await expect(page.getByTestId("orders-report-totals")).toContainText(String(orders.sum.orders));
      const ordersCsv = await csvFrom(page, page.getByRole("button", { name: "Download CSV" }));
      expect(ordersCsv.name).toBe("order-book.csv");
      expect(ordersCsv.lines[0]).toBe("Order month,Orders,Late,Ordered kg,Dispatched kg,Baki kg,Dispatched %");
      expect(ordersCsv.lines).toHaveLength(orders.rows.length + 2);
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);
      await context.close();
    });
  });
}

test.describe("who sees what", () => {
  test("viewer reads the reports but never a rupee; asking for rates is refused", async ({ browser }) => {
    const viewer = await apiAs("viewer");
    expect((await viewer.q<Orders>("analytics.orders", { groupBy: "customer" })).ratesAllowed).toBe(false);
    expect(await viewer.status("analytics.orders", { groupBy: "customer", withRates: true })).toBe(403);
    // The seed keeps prices off on orders, so even the office (order.price) is refused rupees.
    expect(await office.status("analytics.orders", { groupBy: "customer", withRates: true })).toBe(403);
    await viewer.dispose();

    const { page, context } = await openAs(browser, "viewer", 820, "/reports/orders?rates=true");
    await expect(page.getByTestId("orders-report-table")).toBeVisible();
    await expect(page.getByTestId("rate-column")).toHaveCount(0);
    await expect(page.getByLabel("Show rupees")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Ordered Rs");
    await context.close();
  });

  test("a floor role without reports.read is refused the pages, the nav entry and the data", async ({ browser }) => {
    const operator = await apiAs("operator");
    for (const [path, input] of [
      ["analytics.stockAge", {}],
      ["analytics.orders", { groupBy: "customer" }],
      ["analytics.recovery", { from: day, to: day, groupBy: "die" }],
      ["analytics.dieLife", {}],
    ] as const) {
      expect({ path, status: await operator.status(path, input) }).toEqual({ path, status: 403 });
    }
    await operator.dispose();
    const { page, context } = await openAs(browser, "operator", 1280, "/reports");
    await expect(page.getByTestId("reports-no-access")).toBeVisible();
    await expect(page.getByTestId("reports-list")).toHaveCount(0);
    await expect(page.locator('nav a[href="/reports"]')).toHaveCount(0);
    await page.goto("/reports/stock-age");
    await expect(page.getByTestId("reports-no-access")).toBeVisible();
    await context.close();
  });

  test("Hindi at 375: the list and a report in Hindi, no sideways scroll, axe", async ({ browser }) => {
    const { page, context } = await openAs(browser, "office", 375, "/reports", { locale: "hi" });
    await expect(page.getByRole("heading", { name: "रिपोर्ट", level: 1 })).toBeVisible();
    await expect(page.getByTestId("reports-list").getByRole("link", { name: /स्टॉक की उम्र/ })).toBeVisible();
    expect(await axeSerious(page)).toEqual([]);
    await page.goto("/reports/stock-age");
    await expect(page.getByRole("heading", { name: "स्टॉक की उम्र", level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.goto(`/reports/production?from=${day}&to=${day}`);
    await expect(page.getByRole("heading", { name: "प्रोडक्शन रिपोर्ट", level: 1 })).toBeVisible();
    await expect(page.getByTestId("recovery-summary").getByRole("heading", { name: "रिकवरी" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await axeSerious(page)).toEqual([]);
    await context.close();
  });

  test("Today shows stock older than 90 days to the owner; the die card shows life used", async ({ browser }) => {
    const owner = await apiAs("owner");
    const age = await owner.q<StockAge>("analytics.stockAge", {});
    const life = await owner.q<DieLife>("analytics.dieLife", { withLife: true, includeRetired: false, limit: 100, offset: 0 });
    const tee = life.items.find((i) => i.code === "13090-1")!;
    await owner.dispose();

    const { page, context } = await openAs(browser, "owner", 820, "/today");
    const tile = page.getByTestId("today-old-stock");
    await expect(tile).toBeVisible({ timeout: 20_000 });
    await expect(tile).toContainText("Stock older than 90 days");
    await expect(tile).toContainText(String(age.over90.bundles));
    await tile.getByRole("link").click();
    await expect(page).toHaveURL(/\/reports\/stock-age/);

    await page.goto(`/dies/copies/${tee.dieInstanceId}?tab=runs`);
    const header = page.getByTestId("die-life-header");
    await expect(header).toBeVisible();
    await expect(header).toContainText(`${tee.usedPct} % used`);
    await context.close();

    // The viewer's Today has no such tile (four KPIs only).
    const v = await openAs(browser, "viewer", 375, "/today");
    await expect(v.page.getByTestId("today-old-stock")).toHaveCount(0);
    await v.context.close();
  });
});
