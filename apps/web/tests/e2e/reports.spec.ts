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

/**
 * Click a CSV button and return the file's name and lines. Every report file starts with the UTF-8
 * BOM (EF BB BF), so Excel reads Hindi; the lines are returned without it.
 */
async function csvFrom(page: Page, button: ReturnType<Page["getByRole"]>) {
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  const bytes = await readFile((await download.path())!);
  expect([...bytes.subarray(0, 3)], `${download.suggestedFilename()} starts with the UTF-8 BOM`).toEqual([0xef, 0xbb, 0xbf]);
  return { name: download.suggestedFilename(), lines: bytes.subarray(3).toString("utf8").trim().split("\n") };
}

/** Grams as the page writes kg: "1,280.000" (Indian grouping: "12,80,000.000" from a lakh). */
const expectedKg = (g: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(g / 1000);
/** Half-up share in basis points, then one decimal: the server's rule, worked independently. */
const pct1 = (num: number, den: number) => {
  const bp = Math.floor((num * 10_000 * 2 + den) / (den * 2));
  const tenths = Math.floor((bp + 5) / 10);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
};

type Recovery = { rows: { key: string; label: string; runs: number; inputG: number; goodG: number; recoveryPct: string | null }[]; totals: { runs: number; inputG: number; goodG: number; recoveryPct: string | null } };
type DieLife = { items: { dieInstanceId: string; code: string; lifeG: number | null; producedG: number; usedPct: string | null; state: string }[] };
type StockAge = {
  totals: { bundles: number; kgG: number };
  over90: { bundles: number };
  buckets: { key: string; bundles: number; kgG: number }[];
  rows: { customerId: string | null }[];
};
type OrdersSum = { orders: number; orderedG: number; dispatchedG: number; bakiG: number; dispatchedBp: number };
type Orders = { rows: { key: string; label: string; orders: number; orderedG: number; dispatchedG: number; bakiG: number }[]; sum: OrdersSum; totals: OrdersSum; today: string; ratesAllowed: boolean };

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

      // Seed figures, not the API's say-so (I-4): PR-8 is one of the two logged runs of the day on
      // the seed's P1, the worked example. Channel 1" 12230: 310.400 kg of billet in, 234.200 kg good,
      // 44.800 kg butt, ends and rejects = 75.5 % (234,200 / 310,400 = 75.45 %, half up).
      const chan = summary.getByTestId("recovery-table").locator("tbody tr").filter({ hasText: "12230" });
      await expect(chan).toHaveCount(1);
      const chanCells = (await chan.locator("th,td").allInnerTexts()).map((c) => c.trim());
      expect(chanCells.slice(1, 6)).toEqual(["1", "310.400", "234.200", "44.800", "75.5"]);
      expect(byDie.rows.find((r) => r.label === "12230")?.recoveryPct).toBe("75.5");
      expect(pct1(234_200, 310_400)).toBe("75.5");
      // P1's total is exactly the seed's two logged runs of the day there (docs/DEMO_PLANT.md): PR-8
      // (12230, 75.5 %) and PR-11, the reject-heavy patti run on 14701 (296.000 kg in, 211.500 kg good =
      // 71.45 %, 71.5 % half up). Together 606.400 kg in, 445.700 kg good = 73.50 %. The day's total is not
      // pinned: specs running alongside (press.spec, chain.spec) log production runs today on press lines
      // of their own (MERGER-10). It must still be its rows summed, and the page shows it.
      const p1 = await office.q<Recovery>("analytics.recovery", { from: day, to: day, groupBy: "die", pressLineId: "dev-press-line-1" });
      expect(p1.totals).toMatchObject({ runs: 2, inputG: 606_400, goodG: 445_700, recoveryPct: "73.5" });
      expect(pct1(445_700, 606_400)).toBe("73.5");
      expect(p1.rows.map((r) => [r.label, r.runs, r.inputG, r.goodG, r.recoveryPct]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
        ["12230", 1, 310_400, 234_200, "75.5"],
        ["14701", 1, 296_000, 211_500, "71.5"],
      ]);
      const sumOf = (k: "runs" | "inputG" | "goodG") => byDie.rows.reduce((n, r) => n + r[k], 0);
      expect({ runs: sumOf("runs"), inputG: sumOf("inputG"), goodG: sumOf("goodG") }).toEqual({ runs: byDie.totals.runs, inputG: byDie.totals.inputG, goodG: byDie.totals.goodG });
      expect(byDie.totals.recoveryPct).toBe(pct1(byDie.totals.goodG, byDie.totals.inputG));
      await expect(summary.getByTestId("recovery-totals")).toContainText(byDie.totals.recoveryPct!);

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
      // Seed figures (I-4): 13090-1 has a 60,000 kg life. Its share is worked here from the kg it has
      // pressed (the server's rule: half up, one decimal), not read back from the API.
      expect(tee.lifeG).toBe(60_000_000);
      expect(tee.usedPct).toBe(pct1(tee.producedG, tee.lifeG!));
      await expect(row).toContainText("60,000.000");
      await expect(row).toContainText(`${pct1(tee.producedG, 60_000_000)} % used`);
      const lifeCsv = await csvFrom(page, page.getByRole("button", { name: "Download CSV" }));
      expect(lifeCsv.name).toBe("die-life.csv");
      expect(lifeCsv.lines[0]).toBe("Die copy,Section,Status,Life kg,Pressed kg,Used,Left kg,Runs,Last run");
      expect(lifeCsv.lines).toHaveLength(life.items.length + 1);
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);

      const age = await office.q<StockAge>("analytics.stockAge", {});
      await page.goto("/reports/stock-age");
      await expect(page.getByRole("heading", { name: "Stock age", level: 1 })).toBeVisible();
      // The seed packs available bundles 0 to 9 days ago, so this is never empty (it fails, not skips).
      expect(age.totals.bundles).toBeGreaterThan(0);
      // Recent stock sits in the young bands and none of the seed is over 90 days old; the bands add up.
      const [d0, d8, d31, d91] = age.buckets;
      expect(d0!.bundles + d8!.bundles).toBeGreaterThan(0);
      expect(d0!.bundles).toBeGreaterThan(0);
      expect(d91!.bundles).toBe(0);
      expect(age.buckets.reduce((n, b) => n + b.bundles, 0)).toBe(age.totals.bundles);
      expect(age.buckets.reduce((n, b) => n + b.kgG, 0)).toBe(age.totals.kgG);
      await expect(page.getByTestId("stock-age-table").locator("tbody tr")).toHaveCount(age.rows.length);
      await expect(page.getByTestId("stock-age-totals")).toContainText(`${age.totals.bundles} bundle`);
      // Each band's cell on the page carries that band's bundles and kg.
      for (const b of age.buckets) {
        const cell = page.getByTestId("stock-age-totals").locator(`td[data-bucket="${b.key}"]`);
        if (b.bundles === 0) await expect(cell).toHaveText("—");
        else await expect(cell).toContainText(`${b.bundles} ${b.bundles === 1 ? "bundle" : "bundles"}`);
      }
      const ageCsv = await csvFrom(page, page.getByRole("button", { name: "Download CSV" }));
      expect(ageCsv.name).toMatch(/^stock-age-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(ageCsv.lines.at(-1)).toMatch(new RegExp(`^Total,.*,${age.totals.bundles}$`));
      await page.getByRole("radio", { name: "Plant stock only" }).click();
      await expect(page).toHaveURL(/plant=true/);
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);

      // Order book report (I-2, I-3, I-4): open orders by default, the foot is the order book strip.
      const strip = await office.q<OrdersSum>("orders.bookTotals", { openOnly: true });
      expect(strip.orders).toBeGreaterThan(0); // SO-1, SO-2, SO-3 are open in the seed
      const orders = await office.q<Orders>("analytics.orders", { groupBy: "month", openOnly: true });
      expect(orders.totals).toEqual(strip);
      await page.goto("/reports/orders?group=month");
      await expect(page.getByRole("heading", { name: "Order book report", level: 1 })).toBeVisible();
      await expect(page.getByTestId("orders-status")).toHaveValue("open");
      await expect(page.getByTestId("orders-report-table").locator("tbody tr")).toHaveCount(orders.rows.length);
      const foot = page.getByTestId("orders-report-totals").locator("td");
      expect((await foot.allInnerTexts()).map((c) => c.trim()).slice(0, 6)).toEqual([
        String(strip.orders),
        expect.any(String),
        expectedKg(strip.orderedG),
        expectedKg(strip.dispatchedG),
        expectedKg(strip.bakiG),
        pct1(strip.dispatchedG, strip.orderedG),
      ]);
      // Ordered less dispatched is baki, in the foot as in the strip.
      expect(strip.orderedG - strip.dispatchedG).toBe(strip.bakiG);
      const ordersCsv = await csvFrom(page, page.getByRole("button", { name: "Download CSV" }));
      expect(ordersCsv.name).toBe("order-book.csv");
      expect(ordersCsv.lines[0]).toBe("Order month,Orders,Late,Ordered kg,Dispatched kg,Baki kg,Dispatched %");
      expect(ordersCsv.lines).toHaveLength(orders.rows.length + 2);

      // The months chart: every month from the first order to this month is a bar (empty months too),
      // and the company's current month is the one open (partial) bar.
      const chart = page.getByTestId("chart-order-months");
      await expect(chart).toBeVisible({ timeout: 20_000 });
      const months = orders.rows.map((r) => r.key).sort();
      const monthIndex = (k: string) => Number(k.slice(0, 4)) * 12 + Number(k.slice(5, 7)) - 1;
      const span = monthIndex(orders.today.slice(0, 7)) - monthIndex(months[0]!) + 1;
      await expect(chart.locator('[data-slot="chart-bar-mark"]')).toHaveCount(span);
      await expect(chart.locator("[data-partial]")).toHaveCount(1);
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);
      await context.close();
    });
  });
}

test.describe("order book report", () => {
  test("open orders by default; a seeded party's row is its own strip; the status choice re-filters", async ({ browser }) => {
    // SO-1 is a confirmed seed order, 25 days old (late), with a 200-piece line and an 800 kg line.
    const list = await office.q<{ items: { number: string; customerId: string; orderedG: number }[] }>("orders.list", { limit: 100 });
    const so1 = list.items.find((i) => i.number === "SO-1")!;
    expect(so1.orderedG).toBeGreaterThan(800_000);
    const partyStrip = await office.q<OrdersSum & { lateOrders: number }>("orders.bookTotals", { openOnly: true, customerId: so1.customerId });
    expect(partyStrip.orders).toBeGreaterThanOrEqual(1);
    expect(partyStrip.orderedG).toBeGreaterThanOrEqual(so1.orderedG);
    expect(partyStrip.lateOrders).toBeGreaterThanOrEqual(1);

    const { page, context } = await openAs(browser, "office", 1280, "/reports/orders");
    await expect(page.getByTestId("orders-status")).toHaveValue("open");
    const row = page.getByTestId("orders-report-table").locator(`tbody tr[data-key="${so1.customerId}"]`);
    await expect(row).toBeVisible();
    // Orders, late, ordered kg, dispatched kg, baki kg, dispatched %: the party's strip, worked here.
    expect((await row.locator("td").allInnerTexts()).map((c) => c.trim())).toEqual([
      String(partyStrip.orders),
      String(partyStrip.lateOrders),
      expectedKg(partyStrip.orderedG),
      expectedKg(partyStrip.dispatchedG),
      expectedKg(partyStrip.bakiG),
      pct1(partyStrip.dispatchedG, partyStrip.orderedG),
    ]);
    expect(partyStrip.orderedG - partyStrip.dispatchedG).toBe(partyStrip.bakiG);

    // The foot of the party view is the whole open book.
    const openStrip = await office.q<OrdersSum>("orders.bookTotals", { openOnly: true });
    const foot = page.getByTestId("orders-report-totals").locator("td");
    expect((await foot.allInnerTexts()).map((c) => c.trim())).toEqual(
      expect.arrayContaining([String(openStrip.orders), expectedKg(openStrip.orderedG), expectedKg(openStrip.dispatchedG), expectedKg(openStrip.bakiG)]),
    );

    // Every status, then closed, then cancelled: the foot follows the book's strip for the same filter.
    for (const [value, label, input] of [
      ["all", "All orders", {}],
      ["closed", "Closed orders", { status: "closed" }],
      ["cancelled", "Cancelled orders", { status: "cancelled" }],
    ] as const) {
      await page.getByTestId("orders-status").selectOption({ label });
      await expect(page).toHaveURL(new RegExp(`show=${value}`));
      const strip = await office.q<OrdersSum>("orders.bookTotals", input);
      if (strip.orders === 0) {
        await expect(page.getByText("No orders match.")).toBeVisible();
      } else {
        const cells = (await page.getByTestId("orders-report-totals").locator("td").allInnerTexts()).map((c) => c.trim());
        await expect.poll(async () => (await page.getByTestId("orders-report-totals").locator("td").first().innerText()).trim()).toBe(String(strip.orders));
        expect(cells.length).toBeGreaterThan(0);
        await expect(page.getByTestId("orders-report-totals")).toContainText(expectedKg(strip.bakiG));
      }
    }
    await page.getByTestId("orders-status").selectOption({ label: "Open orders" });
    await expect(page).not.toHaveURL(/show=/);
    await context.close();
  });
});

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
