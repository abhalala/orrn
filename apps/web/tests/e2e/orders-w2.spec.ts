import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import {
  closeOrders,
  confirmedOrder,
  dispatchNow,
  DIE_ANGLE,
  DIE_PATTI,
  DIE_PATTI_15,
  FT12,
  FT18,
  kg3,
  m,
  makeParty,
  packFor,
  q,
  ymdPlus,
} from "./helpers/orders-api";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Orders, Wave 2 re-pass (W2-OPPK-W): the order book at a glance (FP-OP-20), the order form with
 * lengths under their die and an expected date (FP-OP-01/02), the in-stock bundle count and line
 * filters (FP-OP-05), the late rule by expected date (FP-OP-18), stock held on an order printed and
 * exported (FP-OP-19) and the plan draft in three views (FP-OP-11).
 *
 * Every test makes its own party (own name, own city), orders and bundles over the API and closes
 * its orders at the end: it never touches the seeded SO-1/SO-2/SO-3.
 */

const WIDTHS = [375, 820, 1280] as const;
test.describe.configure({ timeout: 150_000 });

async function open(page: Page, opts: { role?: LocalRole; width: number; path: string; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(opts.path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function settled(page: Page) {
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude(".TanStackRouterDevtools")
    .exclude("[class*='tsqd-']")
    .exclude("[data-sonner-toaster]")
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, targets: v.nodes.slice(0, 4).map((n) => n.target.join(" ")) }));
}

type BookItem = { id: string; number: string; orderedG: number; bakiG: number; lateDays: number | null; lateRule: string | null; bar: Record<string, number> };
type Book = { items: BookItem[]; total: number; totals: Record<string, number> };

/** A party with two confirmed orders: one with stock and a dispatch, one past its expected date. */
async function book(page: Page) {
  const party = await makeParty(page, "Book");
  const stocked = await confirmedOrder(page, party.id, [{ pcs: 100 }]);
  const bundles = await packFor(page, stocked.lineIds[0]!, [30, 40, 50]);
  const sent = await dispatchNow(page, stocked.id, [bundles[0]!]);
  const overdue = await confirmedOrder(page, party.id, [{ pcs: 10 }], { expectedDate: "2020-01-01" });
  return { party, stocked, overdue, bundles, sent, ids: [stocked.id, overdue.id] };
}

test.describe("the order book at a glance", () => {
  for (const width of WIDTHS) {
    test(`strip, bars, late and filters at ${width}`, async ({ page }) => {
      await open(page, { width, path: "/orders" });
      const w = await book(page);
      try {
        const api = await q<Book>(page, "orders.list", { openOnly: true, city: w.party.city, limit: 100 });
        expect(api.items.map((i) => i.id).sort()).toEqual([...w.ids].sort());

        await page.goto(`/orders?city=${encodeURIComponent(w.party.city)}`);
        await settled(page);
        const main = page.locator("main#main");
        await expect(main.locator("[data-order-bar]")).toHaveCount(2);

        // The header strip is the server's totals for this filter, and they are the sum of the grid.
        const sum = (f: (i: BookItem) => number) => api.items.reduce((s, i) => s + f(i), 0);
        expect(api.totals.orderedG).toBe(sum((i) => i.orderedG));
        expect(api.totals.dispatchedG).toBe(sum((i) => i.bar.dispatchedG!));
        expect(api.totals.inStockG).toBe(sum((i) => i.bar.inStockG!));
        expect(api.totals.bakiG).toBe(sum((i) => i.bakiG));
        const strip = main.locator("[data-book-strip]");
        await expect(strip.locator("[data-book-total='orders']")).toContainText("2");
        await expect(strip.locator("[data-book-total='ordered']")).toContainText(`${kg3(api.totals.orderedG!)} kg`);
        await expect(strip.locator("[data-book-total='inStock']")).toContainText(`${kg3(api.totals.inStockG!)} kg`);
        await expect(strip.locator("[data-book-total='inStock']")).toContainText("2 bundles");
        await expect(strip.locator("[data-book-total='dispatched']")).toContainText(`${kg3(api.totals.dispatchedG!)} kg`);
        await expect(strip.locator("[data-book-total='dispatched']")).toContainText(/\d+(\.\d)?% dispatched/);
        await expect(strip.locator("[data-book-total='baki']")).toContainText(`${kg3(api.totals.bakiG!)} kg`);
        await expect(main.locator("[data-book-late]")).toContainText("Late: 1");

        // One bar per order: its segments are the server's kg, and the label says what the percent is.
        const bar = main.locator(`[data-order-bar='${w.stocked.number}']`);
        const stockedApi = api.items.find((i) => i.id === w.stocked.id)!;
        await expect(bar.locator("[data-bar-label]")).toHaveText(/^\d+(\.\d)?% dispatched$/);
        await expect(bar.locator("[data-segment='dispatched']")).toHaveAttribute("data-kg", String(stockedApi.bar.dispatchedG));
        await expect(bar.locator("[data-segment='inStock']")).toHaveAttribute("data-kg", String(stockedApi.bar.inStockG));
        const shown = await bar.locator("[data-segment]").evaluateAll((els) => els.reduce((s, e) => s + Number(e.getAttribute("data-kg")), 0));
        expect(shown).toBe(stockedApi.orderedG);
        // An order with nothing in motion is a grey bar and its baki.
        const idle = main.locator(`[data-order-bar='${w.overdue.number}']`);
        await expect(idle.locator("[data-segment]")).toHaveCount(0);
        await expect(idle).toContainText("Nothing planned yet");
        await expect(idle).toContainText(`Baki ${kg3(api.items.find((i) => i.id === w.overdue.id)!.bakiG)} kg`);

        // Late by the expected date, and the chip says which date.
        const lateChip = main.locator("[data-slot='chip']").filter({ hasText: /Late, \d+ days/ });
        await expect(lateChip).toHaveCount(1);
        await expect(lateChip).toHaveAttribute("title", "Its expected date has passed");

        if (width === 1280) {
          // The Ordered kg column adds up to the strip.
          const cells = await main.locator("table tbody tr td:nth-child(7)").allTextContents();
          const total = cells.reduce((s, c) => s + Number(c.replace(/,/g, "")), 0);
          expect(Math.round(total * 1000)).toBe(api.totals.orderedG);
        }
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main#main");
        if (width === 375) expect(await axeViolations(page)).toEqual([]);

        // Filters live in the URL and narrow rows and strip together.
        await page.getByLabel("Stage", { exact: true }).selectOption("in_stock");
        await expect(page).toHaveURL(/stage=in_stock/);
        await expect(main.locator("[data-order-bar]")).toHaveCount(1);
        await expect(main.locator(`[data-order-bar='${w.stocked.number}']`)).toBeVisible();
        await page.getByLabel("Stage", { exact: true }).selectOption("planned");
        await expect(main.getByText("No orders match")).toBeVisible();
        await expect(strip.locator("[data-book-total='ordered']")).toContainText("0.000 kg");
        await page.getByRole("button", { name: "Clear filters" }).click();
        await expect(page).toHaveURL(/\/orders\/?$/);
        // The sent order moved to Dispatching with its first load.
        await page.goto(`/orders?city=${encodeURIComponent(w.party.city)}&show=dispatching`);
        await expect(main.locator("[data-order-bar]")).toHaveCount(1);
        await expect(main.locator(`[data-order-bar='${w.stocked.number}']`)).toBeVisible();
        await expect(page.getByLabel("Status", { exact: true })).toHaveValue("dispatching");
      } finally {
        await closeOrders(page, w.ids);
      }
    });
  }

  test("filters come from the URL: late, party, city, dates; closed orders keep their own view", async ({ page }) => {
    await open(page, { width: 1280, path: "/orders" });
    const w = await book(page);
    try {
      const city = encodeURIComponent(w.party.city);
      await page.goto(`/orders?show=late&city=${city}`);
      await settled(page);
      const main = page.locator("main#main");
      await expect(page.getByRole("radio", { name: "Late" })).toBeChecked();
      await expect(page.getByLabel("City", { exact: true })).toHaveValue(w.party.city);
      await expect(main.locator("[data-order-bar]")).toHaveCount(1);
      await expect(main.locator(`[data-order-bar='${w.overdue.number}']`)).toBeVisible();
      await expect(main.locator("[data-book-total='orders']")).toContainText("1");

      // Party and order-date range.
      await page.goto(`/orders?party=${w.party.id}&from=2999-01-01`);
      await settled(page);
      await expect(main.getByText("No orders match")).toBeVisible();
      await page.goto(`/orders?party=${w.party.id}&to=2999-01-01`);
      await settled(page);
      await expect(main.locator("[data-order-bar]")).toHaveCount(2);
      await expect(page.getByRole("combobox", { name: "Party" })).toHaveValue(w.party.name);

      // Typing in the date box and the search box writes the URL.
      await page.goto(`/orders?city=${city}`);
      await settled(page);
      await page.getByRole("textbox", { name: "Search orders" }).fill(w.overdue.po);
      await expect(page).toHaveURL(new RegExp(`q=${w.overdue.po}`));
      await expect(main.locator("[data-order-bar]")).toHaveCount(1);
      await page.getByLabel("Ordered from").fill("2999-01-01");
      await expect(page).toHaveURL(/from=2999-01-01/);
      await expect(main.getByText("No orders match")).toBeVisible();

      // A closed order is under Closed, not under Open.
      await closeOrders(page, [w.overdue.id]);
      await page.goto(`/orders?city=${city}&show=closed`);
      await expect(page.getByRole("radio", { name: "Closed" })).toBeChecked();
      await expect(main.locator(`[data-order-bar='${w.overdue.number}']`)).toBeVisible();
      await page.goto(`/orders?city=${city}`);
      await expect(main.locator(`[data-order-bar='${w.overdue.number}']`)).toHaveCount(0);
    } finally {
      await closeOrders(page, w.ids);
    }
  });
});

test.describe("the order form: lengths under their die, expected date", () => {
  for (const width of [375, 1280] as const) {
    test(`Enter adds a length, Shift+Enter a die, totals follow, the expected date starts 15 days out at ${width}`, async ({ page }) => {
      await open(page, { role: "office", width, path: "/orders/new" });
      const party = await makeParty(page, "Form");
      let created: string | null = null;
      try {
        await page.goto("/orders/new");
        await expect(page.locator("main#main h1").first()).toBeVisible();
        const expectedInput = page.getByLabel("Expected by");
        await expect(expectedInput).toHaveValue(ymdPlus(15));
        await expect(page.getByText("Starts 15 days after the order date.")).toBeVisible();

        await page.getByRole("combobox", { name: "Customer" }).fill(party.name.slice(0, 10));
        await page.getByRole("option", { name: new RegExp(party.name) }).click();
        await page.getByRole("combobox", { name: "Die", exact: true }).fill("14701");
        await page.getByRole("option", { name: /14701/ }).first().click();
        await page.getByLabel("Die copy").selectOption({ label: "Tier 1 or better" });

        const block = page.locator("[data-die-block='1']");
        const row1 = block.locator("[data-length-row='1']");
        await row1.getByRole("button", { name: "12 ft" }).click();
        const pcs1 = row1.getByRole("textbox", { name: "Pieces" });
        await pcs1.fill("30");
        await expect(row1.locator("[data-quote]")).toContainText("30 pcs come to");

        // Enter in pieces: the next length opens under the same die, focus in its length cell.
        await pcs1.press("Enter");
        const row2 = block.locator("[data-length-row='2']");
        await expect(row2).toBeVisible();
        await expect(row2.getByRole("textbox", { name: "feet" })).toBeFocused();
        await expect(page.locator("[data-die-block]")).toHaveCount(1);
        await row2.getByRole("button", { name: "18 ft" }).click();
        await row2.getByRole("textbox", { name: "kg", exact: true }).fill("100");
        await expect(row2.locator("[data-quote]")).toContainText(/pcs weigh/);

        // The totals are the quotes added up: lines, pieces and kg of this die and of the order.
        const q1 = await q<{ pcs: number; kgG: number }>(page, "orders.quote", { sectionId: DIE_PATTI, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 30, weightBasis: "copy_current" });
        const q2 = await q<{ pcs: number; kgG: number }>(page, "orders.quote", { sectionId: DIE_PATTI, cutLengthMm: FT18, qtyBasis: "kg", kgG: 100_000, weightBasis: "copy_current" });
        const totalKg = kg3(q1.kgG + q2.kgG);
        await expect(block.locator("[data-block-total]")).toContainText(`2 lengths, ${q1.pcs + q2.pcs} pcs, ${totalKg} kg`);
        await expect(page.locator("[data-order-total]")).toContainText(`2 lengths, ${q1.pcs + q2.pcs} pcs, ${totalKg} kg`);
        await expect(row1.locator("[data-share]")).toContainText("% of the order");

        // Shift+Enter: another die. A removed die takes its lengths with it.
        await row2.getByRole("textbox", { name: "kg", exact: true }).press("Shift+Enter");
        await expect(page.locator("[data-die-block='2']")).toBeVisible();
        await page.getByRole("button", { name: "Remove die 2" }).click();
        await expect(page.locator("[data-die-block]")).toHaveCount(1);

        // A length can be copied and removed.
        await row1.getByRole("button", { name: "Copy length 1" }).click();
        await expect(block.locator("[data-length-row]")).toHaveCount(3);
        await page.getByRole("button", { name: "Remove length 2" }).click();
        await expect(block.locator("[data-length-row]")).toHaveCount(2);

        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main#main");

        // The date is editable; the order is saved with it and one line per length.
        await expectedInput.fill("2031-03-05");
        await page.getByRole("button", { name: "Book order" }).click();
        await expect(page.getByRole("heading", { level: 1 })).toContainText(/SO-\d+/);
        await expect(page).toHaveURL(/\/orders\/(?!new$)[^/]+$/);
        created = new URL(page.url()).pathname.split("/").pop()!;
        const got = await q<{ order: { expectedDate: string; customerId: string }; lines: { sectionId: string; cutLengthMm: number; orderedPcs: number }[] }>(page, "orders.get", { id: created });
        expect(got.order).toMatchObject({ expectedDate: "2031-03-05", customerId: party.id });
        expect(got.lines.map((l) => [l.sectionId, l.cutLengthMm])).toEqual([
          [DIE_PATTI, FT12],
          [DIE_PATTI, FT18],
        ]);
        await expect(page.getByText("Expected by")).toBeVisible();
      } finally {
        if (created) await m(page, "orders.cancel", { id: created, reason: "W2 e2e cleanup" }).catch(() => undefined);
      }
    });
  }

  test("a new order's expected date follows the plant's lead days; the edit sheet changes it", async ({ page }) => {
    await open(page, { width: 1280, path: "/orders/new" });
    await m(page, "company.updateSettings", { orderLeadDays: 7 });
    let made: string | null = null;
    try {
      await page.reload();
      await expect(page.getByLabel("Expected by")).toHaveValue(ymdPlus(7));
      await expect(page.getByText("Starts 7 days after the order date.")).toBeVisible();

      const party = await makeParty(page, "Edit");
      const order = await confirmedOrder(page, party.id, [{ pcs: 5 }], { expectedDate: "2031-01-10" });
      made = order.id;
      await page.goto(`/orders/${order.id}`);
      await settled(page);
      await expect(page.getByText("Expected by")).toBeVisible();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByLabel("Expected by")).toHaveValue("2031-01-10");
      await sheet.getByLabel("Expected by").fill("2031-02-02");
      await sheet.getByRole("button", { name: "Save" }).click();
      await expect(sheet).toBeHidden();
      expect((await q<{ order: { expectedDate: string } }>(page, "orders.get", { id: order.id })).order.expectedDate).toBe("2031-02-02");
    } finally {
      await m(page, "company.updateSettings", { orderLeadDays: 15 });
      if (made) await closeOrders(page, [made]);
    }
  });
});

test.describe("an order's page: bundle count, line filters, stock held on it", () => {
  test("in stock gives pieces and bundles; the stock list is shown, printed and exported", async ({ page }) => {
    await open(page, { width: 1280, path: "/orders" });
    const party = await makeParty(page, "Stock");
    const o = await confirmedOrder(page, party.id, [{ pcs: 100 }]);
    try {
      const serials = await packFor(page, o.lineIds[0]!, [40, 60]);
      await page.goto(`/orders/${o.id}`);
      await settled(page);
      const inStock = page.locator("[data-order-line='1'] [data-strip='inStockG']");
      await expect(inStock).toContainText("100.000 kg");
      await expect(inStock).toContainText("20 pcs");
      await expect(inStock).toContainText("2 bundles");

      await page.getByRole("button", { name: "Stock on this order" }).click();
      const sheet = page.getByRole("dialog", { name: `Stock on ${o.number}` });
      await expect(sheet.locator("[data-stock-on-total]")).toContainText("2 bundles");
      await expect(sheet.locator("[data-stock-on-total]")).toContainText("100.000 kg");
      for (const s of serials) await expect(sheet.getByText(s, { exact: true })).toBeVisible();

      const [xlsx] = await Promise.all([page.waitForEvent("download"), sheet.getByRole("button", { name: "Excel" }).click()]);
      expect(xlsx.suggestedFilename()).toBe(`stock-on-${o.number}.xlsx`);
      const [pdf] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), sheet.getByRole("button", { name: "PDF" }).click()]);
      expect(pdf.suggestedFilename()).toBe(`stock-on-${o.number}.pdf`);
      await sheet.getByRole("button", { name: "Print" }).click();
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Could not make the file" })).toHaveCount(0);
      await sheet.getByRole("button", { name: "Close" }).last().click();

      // A sent bundle is not stock any more.
      await dispatchNow(page, o.id, [serials[0]!]);
      const after = await q<{ total: { bundles: number } }>(page, "orders.stockOn", { id: o.id });
      expect(after.total.bundles).toBe(1);
    } finally {
      await closeOrders(page, [o.id]);
    }
  });

  test("an order with 20 or more lines can be filtered by die, cut length, stage and baki", async ({ page }) => {
    await open(page, { width: 1280, path: "/orders" });
    const party = await makeParty(page, "Long");
    const dies = [DIE_PATTI, DIE_PATTI_15, DIE_ANGLE];
    const lines = Array.from({ length: 21 }, (_, i) => ({ sectionId: dies[i % 3]!, cutLengthMm: i % 2 === 0 ? FT12 : FT18, pcs: 5 + i }));
    const o = await confirmedOrder(page, party.id, lines);
    // A short order has no filters.
    const short = await confirmedOrder(page, party.id, [{ pcs: 3 }]);
    try {
      await page.goto(`/orders/${short.id}`);
      await settled(page);
      await expect(page.locator("[data-line-filters]")).toHaveCount(0);

      // Stock on one line, so the stage filter has something to find.
      await packFor(page, o.lineIds[0]!, [10]);
      await page.goto(`/orders/${o.id}`);
      await settled(page);
      const filters = page.locator("[data-line-filters]");
      await expect(filters).toBeVisible();
      await expect(page.locator("[data-order-line]")).toHaveCount(21);
      await expect(filters.locator("[data-line-filter-totals]")).toContainText("21 of 21 lines");

      await filters.getByLabel("Cut length", { exact: true }).selectOption({ label: "18 ft" });
      await expect(page.locator("[data-order-line]")).toHaveCount(10);
      await expect(filters.locator("[data-line-filter-totals]")).toContainText("10 of 21 lines");
      await filters.getByLabel("Die", { exact: true }).selectOption({ index: 1 });
      await expect(filters.locator("[data-line-filter-totals]")).toContainText(/\d+ of 21 lines/);
      await filters.getByRole("button", { name: "Clear filters" }).click();
      await expect(page.locator("[data-order-line]")).toHaveCount(21);

      await filters.getByLabel("Stage", { exact: true }).selectOption("in_stock");
      await expect(page.locator("[data-order-line]")).toHaveCount(1);
      await expect(page.locator("[data-order-line='1']")).toBeVisible();
      await filters.getByRole("button", { name: "Clear filters" }).click();
      await filters.getByLabel("Stage", { exact: true }).selectOption("dispatched");
      await expect(filters.locator("[data-line-filter-totals]")).toContainText("0 of 21 lines");
      await expect(page.getByText("No line matches these filters.")).toBeVisible();
      await filters.getByRole("button", { name: "Clear filters" }).click();
      await filters.getByText("Has baki").click();
      await expect(page.locator("[data-order-line]")).toHaveCount(21);
      await expectNoHorizontalScroll(page);
    } finally {
      await closeOrders(page, [o.id, short.id]);
    }
  });

  test("the late chip names its date; Dispatch opens a dispatch for the order", async ({ page }) => {
    await open(page, { width: 1280, path: "/orders" });
    const party = await makeParty(page, "Late");
    const o = await confirmedOrder(page, party.id, [{ pcs: 10 }], { expectedDate: "2020-02-02" });
    try {
      await page.goto(`/orders/${o.id}`);
      await settled(page);
      const chip = page.locator("[data-slot='chip']").filter({ hasText: /Late, \d+ days/ });
      await expect(chip).toHaveAttribute("title", "Its expected date has passed");
      await page.locator("[data-dispatch-from-order]").click();
      await expect(page).toHaveURL(new RegExp(`/dispatch/new\\?salesOrderId=${o.id}`));
    } finally {
      await closeOrders(page, [o.id]);
    }
  });
});

test.describe("the press plan draft in three views", () => {
  test("by die, by order and all lines; add all of this order; the footer counts orders", async ({ page }) => {
    await open(page, { role: "office", width: 1280, path: "/orders/plan" });
    const party = await makeParty(page, "Plan");
    const o = await confirmedOrder(page, party.id, [
      { sectionId: DIE_PATTI, pcs: 20 },
      { sectionId: DIE_PATTI_15, pcs: 8 },
    ]);
    const second = await confirmedOrder(page, party.id, [{ sectionId: DIE_PATTI, pcs: 6 }]);
    try {
      await page.goto("/orders/plan");
      await settled(page);
      await page.getByRole("textbox", { name: "Search open lines" }).fill(party.name);
      await page.locator(`[data-add-all='${o.number}']`).first().click();
      const press = page.getByLabel("Press", { exact: true });
      if ((await press.count()) > 0) await press.selectOption({ index: 1 });
      // With one order on the draft there is nothing to switch yet beyond the dies.
      await page.locator(`[data-candidate='${second.number}']`).getByRole("button", { name: "Add" }).click();
      await expect(page.locator("[data-draft-footer]")).toHaveText("2 dies, 3 lines");
      await expect(page.locator("[data-draft-orders]")).toHaveText("2 sales orders on the draft");

      const views = page.getByRole("radiogroup", { name: "View" });
      await expect(views.getByRole("radio", { name: "By die" })).toBeChecked();
      await expect(page.locator("[data-draft-die]")).toHaveCount(2);

      await views.getByRole("radio", { name: "By order" }).check();
      await expect(page.locator("[data-draft-view='order']")).toBeVisible();
      await expect(page.locator("[data-draft-group]")).toHaveCount(2);
      await expect(page.locator(`[data-draft-group='${o.number}'] [data-draft-line]`)).toHaveCount(2);
      await expect(page.locator(`[data-draft-group='${second.number}'] [data-draft-line]`)).toHaveCount(1);
      await expect(page.locator("[data-draft-die]")).toHaveCount(0);

      await views.getByRole("radio", { name: "All lines" }).check();
      await expect(page.locator("[data-draft-view='flat']")).toBeVisible();
      await expect(page.locator("[data-draft-group]")).toHaveCount(1);
      await expect(page.locator("[data-draft-line]")).toHaveCount(3);
      // The footer and the kg boxes work the same in every view.
      await expect(page.locator("[data-draft-footer]")).toHaveText("2 dies, 3 lines");
      await page.locator(`[data-draft-line='${second.number}']`).getByRole("button", { name: "Remove" }).click();
      await expect(page.locator("[data-draft-line]")).toHaveCount(2);
      await expect(page.locator("[data-draft-orders]")).toHaveText("1 sales order on the draft");
      await views.getByRole("radio", { name: "By die" }).check();
      await expect(page.locator("[data-draft-die]")).toHaveCount(2);
      expect(await axeViolations(page)).toEqual([]);
    } finally {
      await closeOrders(page, [o.id, second.id]);
    }
  });
});

test.describe("Hindi", () => {
  test("the order book, the order form and the dispatch form read in Hindi at 375 without sideways scroll", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
    await open(page, { role: "office", width: 375, path: "/orders" });
    const w = await book(page);
    try {
      const city = encodeURIComponent(w.party.city);
      for (const path of [`/orders?city=${city}`, "/orders/new", `/orders/${w.stocked.id}`, `/dispatch/new?salesOrderId=${w.stocked.id}`]) {
        await page.goto(path);
        await expect(page.locator("main#main h1").first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", "hi");
        await settled(page);
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main#main");
        expect(await axeViolations(page), path).toEqual([]);
      }
      await page.goto(`/orders?city=${city}`);
      await expect(page.locator("[data-book-late]")).toContainText("लेट: 1");
      await expect(page.locator(`[data-order-bar='${w.stocked.number}'] [data-bar-label]`)).toContainText("dispatch हुआ");
    } finally {
      await closeOrders(page, w.ids);
    }
  });
});
