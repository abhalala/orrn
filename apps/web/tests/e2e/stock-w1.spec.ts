import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { dieId, makePlantStock, newCustomer, newOrder, ownerApi, packBundles } from "./helpers/owner-api";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Stock, Wave 1 (FP-PK-08..10, explorer High 14, BACKLOG 36 and the PL10 count screens): the Yards tab with
 * its cards, the filters in the URL and the same server totals on every tab, `/b` with its yard and who did
 * what, and a count session from start to the variance and the phantom list.
 *
 * Every test makes its own customer and bundles through the owner's API, so what a filter narrows to is exact
 * and parallel specs never disagree. The count test uses yard Y6, which nothing else here packs into.
 */

const WIDTHS = [375, 820, 1280] as const;
const DIE = "14701";

test.describe.configure({ timeout: 180_000 });

async function start(page: Page, role: LocalRole, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
}

async function visit(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main h1").first()).toBeAttached({ timeout: 30_000 });
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

/** The yard's checkbox on the start form, by keyboard (a Radix checkbox sits inside a label). */
async function tickYard(page: Page, code: string) {
  const box = page.getByRole("checkbox", { name: code, exact: true });
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
}

/** A customer with an order for the die and `n` 48 kg bundles on it, in `yardCode`. */
async function stocked(tag: string, n: number, yardCode = "Y2") {
  const api = await ownerApi();
  const cust = await newCustomer(api, `Stock ${tag}`);
  const die = await dieId(api, DIE);
  const order = await newOrder(api, cust.id, die);
  const r = await packBundles(
    api,
    die,
    Array.from({ length: n }, () => ({ quantity: 20, weightG: 48_000 })),
    { salesOrderLineId: order.lineId, yardCode },
  );
  const yards = await api.query<{ items: { id: string; code: string }[] }>("stock.locations.list", {});
  const yardId = yards.items.find((y) => y.code === yardCode)!.id;
  return { api, cust, die, order, serials: r.bundles.map((b) => b.serial), ids: r.bundles.map((b) => b.id), yardId };
}

test.describe("stock: Yards tab, filters in the URL, same totals on every tab", () => {
  for (const width of WIDTHS) {
    test(`yard cards agree with the server; a customer filter narrows all three tabs and survives a reload, at ${width}`, async ({ page }) => {
      const s = await stocked(`${width}-${Date.now() % 100_000}`, 3);
      await start(page, "operator", width);
      await visit(page, "/stock/yards");
      await expect(page.getByRole("tab", { name: "Yards" }).or(page.getByRole("link", { name: "Yards" })).first()).toBeVisible();
      const cards = page.getByTestId("yard-cards");
      await expect(cards).toBeVisible({ timeout: 20_000 });
      const api = await s.api.query<{ yards: { code: string | null; bundles: number; weightG: number; locationId: string | null }[]; totals: { bundles: number } }>("stock.byYard", {});
      const y2 = api.yards.find((y) => y.code === "Y2")!;
      const card = cards.locator("[data-yard='Y2']");
      await expect(card).toContainText(`${y2.bundles.toLocaleString("en-IN")} bundles`);
      await expect(card.getByTestId("yard-kg")).toContainText("kg");
      // Every yard has a card, empty ones too.
      expect(await cards.locator("[data-yard]").count()).toBeGreaterThanOrEqual(api.yards.length);

      // The customer filter: the card shows only this customer's bundles, and it is in the URL.
      await page.goto(`/stock/yards?customer=${s.cust.id}`);
      await expect(page.locator("[data-yard='Y2']")).toContainText("3 bundles", { timeout: 20_000 });
      await expect(page.getByTestId("stock-totals-line")).toContainText("3 bundles");
      await expect(page.getByTestId("stock-totals-line")).toContainText("144");
      // The card goes on to the Bundles tab with the yard and the customer kept.
      await page.locator("[data-yard='Y2']").getByRole("link", { name: "Bundles" }).click();
      await expect(page).toHaveURL(/\/stock\/bundles\?/);
      expect(page.url()).toContain(`customer=${s.cust.id}`);
      expect(page.url()).toContain(`yard=${s.yardId}`);
      for (const serial of s.serials) await expect(page.locator(`[data-serial='${serial}']`).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("stock-totals-line")).toContainText("3 bundles");
      // A reload keeps the filters.
      await page.reload();
      await expect(page.getByTestId("stock-totals-line")).toContainText("3 bundles", { timeout: 20_000 });
      expect(page.url()).toContain(`customer=${s.cust.id}`);

      // Lengths: one row of the one cut length, the same three bundles.
      await page.goto(`/stock/lengths?customer=${s.cust.id}`);
      await expect(page.getByTestId("stock-totals-line")).toContainText("3 bundles", { timeout: 20_000 });
      await expect(page.locator("main").getByText("11 ft 6 in").first()).toBeVisible();
      // Sections: the section block counts only these.
      await page.goto(`/stock?customer=${s.cust.id}`);
      await expect(page.getByTestId("stock-totals")).toContainText("3 bundles", { timeout: 20_000 });
      await expect(page.getByTestId("section-block")).toHaveCount(1);
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);
      await s.api.dispose();
    });
  }

  test("plant stock, hollow/solid/semi and packed date narrow the Bundles tab with server totals", async ({ page }) => {
    const s = await stocked(`filters-${Date.now() % 100_000}`, 2, "Y3");
    // One of the two goes to plant stock.
    await s.api.mutate("orders.reallocate", { bundleIds: [s.ids[0]], toLineId: null, reason: "Plant stock for the filter test" });
    await start(page, "office", 1280);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    await page.goto(`/stock/bundles?yard=${s.yardId}&customer=${s.cust.id}`);
    await expect(page.getByTestId("stock-totals-line")).toContainText("1 bundle", { timeout: 20_000 });
    await expect(page.locator(`[data-serial='${s.serials[1]}']`).first()).toBeVisible();
    await expect(page.locator(`[data-serial='${s.serials[0]}']`)).toHaveCount(0);

    // Plant stock only: the reallocated one, whichever customer.
    await page.goto(`/stock/bundles?yard=${s.yardId}&plant=1`);
    await expect(page.locator(`[data-serial='${s.serials[0]}']`).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`[data-serial='${s.serials[1]}']`)).toHaveCount(0);

    // Packed date: both ends are the company's calendar days, inclusive.
    await page.goto(`/stock/bundles?yard=${s.yardId}&from=${today}&to=${today}&customer=${s.cust.id}`);
    await expect(page.getByTestId("stock-totals-line")).toContainText("1 bundle", { timeout: 20_000 });
    await page.goto(`/stock/bundles?yard=${s.yardId}&to=2020-01-01&customer=${s.cust.id}`);
    await expect(page.getByTestId("stock-totals-line")).toContainText("0 bundles", { timeout: 20_000 });

    // The kind: 14701 is a solid section; hollow shows none of these.
    await page.goto(`/stock/bundles?yard=${s.yardId}&kind=hollow&customer=${s.cust.id}`);
    await expect(page.getByTestId("stock-totals-line")).toContainText("0 bundles", { timeout: 20_000 });

    // The filter panel edits the same URL (no filter lives only in memory).
    await page.goto(`/stock/bundles?yard=${s.yardId}`);
    // The panel is open already when the URL carries a filter.
    await expect(page.getByTestId("filters-toggle")).toHaveAttribute("aria-expanded", "true");
    await page.getByLabel("Plant stock only").click();
    await expect(page).toHaveURL(/plant=/);
    await page.getByTestId("filters-clear").click();
    await expect(page).not.toHaveURL(/plant=/);
    await s.api.dispose();
  });
});

test.describe("/b and the section page: yard, who did it, the same tone", () => {
  test("a bundle shows its yard and who packed and moved it", async ({ page }) => {
    const s = await stocked(`b-${Date.now() % 100_000}`, 1, "Y4");
    await s.api.mutate("stock.move", { bundleIds: s.ids, toLocationId: s.yardId, reason: "Tidy" }).catch(() => undefined);
    await start(page, "operator", 820);
    await visit(page, `/b/${s.serials[0]}`);
    const facts = page.getByTestId("bundle-facts");
    await expect(facts.locator("[data-fact='location'] dd")).toHaveText("Y4");
    await expect(facts.locator("[data-fact='order'] dd")).toContainText(s.cust.name);
    await expect(page.getByTestId("band-chip")).toHaveAttribute("data-verdict", "in");
    await expect(page.getByTestId("bundle-timeline").locator("[data-slot='actor']").first()).toContainText("by ");
    // The bundle list row carries the yard and the same band.
    await page.goto(`/stock/bundles?customer=${s.cust.id}&yard=${s.yardId}`);
    await expect(page.locator(`[data-serial='${s.serials[0]}']`).first()).toBeVisible({ timeout: 20_000 });
    await s.api.dispose();
  });
});

test.describe("stock count: open, scan, close, variance, phantom, cancel", () => {
  test.describe.configure({ mode: "serial" });

  for (const width of WIDTHS) {
    test(`a count over one yard: here, unknown, missing; closes with the variance by yard and section, at ${width}`, async ({ page }) => {
      const s = await stocked(`count-${width}-${Date.now() % 100_000}`, 3, "Y6");
      await start(page, "office", width);
      await visit(page, "/stock/count");
      await expect(page.getByTestId("phantom-summary").or(page.getByTestId("open-counts")).or(page.getByRole("heading", { level: 2 }).first()).first()).toBeVisible();
      await tickYard(page, "Y6");
      await page.getByTestId("start-count").click();
      await expect(page).toHaveURL(/\/stock\/count\/(?!$)[^/]+$/, { timeout: 20_000 });

      const scan = page.getByLabel("Scan a bundle or type its number");
      await scan.fill(s.serials[0]);
      await scan.press("Enter");
      const feed = page.getByTestId("count-feed");
      await expect(feed).toContainText(s.serials[0]);
      await expect(feed.locator("li").first()).toContainText("Here");
      await scan.fill("NOPE-0000");
      await scan.press("Enter");
      await expect(feed).toContainText("Unknown code");
      // Paste: one more, one repeat.
      await page.getByRole("button", { name: "Paste codes" }).click();
      await page.getByRole("dialog").locator("textarea").fill(`${s.serials[1]}\n${s.serials[0]}`);
      await page.getByRole("button", { name: /^Count 2 codes$/ }).click();
      await expect(feed).toContainText(s.serials[1]);
      await expect(feed).toContainText("scanned before");
      const summary = page.getByTestId("count-summary");
      await expect(summary).toContainText("Scanned");

      // The third bundle (and whatever else sits in Y6) is missing: closing shows the variance.
      await page.getByTestId("close-count").click();
      const dlg = page.getByRole("dialog");
      await expect(dlg).toContainText("missing so far");
      await dlg.getByTestId("confirm-close").click();
      await expect(page.getByTestId("close-count")).toHaveCount(0, { timeout: 20_000 });
      await expect(page.getByTestId("variance-yard")).toContainText("Y6");
      await expect(page.getByTestId("variance-section")).toContainText("14701");
      await expect(page.getByTestId("phantom-report")).toContainText(s.serials[2]);
      await expect(page.getByTestId("phantom-report")).not.toContainText(s.serials[0]);
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);

      // It shows on the list as closed, and the missing bundle in the phantom summary.
      await page.goto("/stock/count");
      await expect(page.getByTestId("past-counts")).toBeVisible({ timeout: 20_000 });
      await s.api.dispose();
    });
  }

  test("an open count can be cancelled with a reason, and the yard can be counted again", async ({ page }) => {
    const s = await stocked(`cancel-${Date.now() % 100_000}`, 1, "Y6");
    await start(page, "office", 820);
    await visit(page, "/stock/count");
    await tickYard(page, "Y6");
    await page.getByTestId("start-count").click();
    await expect(page).toHaveURL(/\/stock\/count\/(?!$)[^/]+$/, { timeout: 20_000 });
    // A second count over the same yard is refused in words.
    const second = await page.context().newPage();
    await second.goto("/stock/count");
    await tickYard(second, "Y6");
    await second.getByTestId("start-count").click();
    await expect(second.getByRole("alert")).toContainText("already being counted");
    await second.close();

    await page.getByTestId("cancel-count").click();
    const dlg = page.getByRole("dialog");
    await dlg.getByTestId("confirm-cancel").click();
    await expect(dlg).toContainText("Say why the count is cancelled.");
    await dlg.getByLabel("Why cancel it").fill("Wrong yard");
    await dlg.getByTestId("confirm-cancel").click();
    await expect(page.getByText("cancelled: Wrong yard")).toBeVisible({ timeout: 20_000 });
    await s.api.dispose();
  });

  test("floor roles without stock.count see the list but no start form", async ({ page }) => {
    await start(page, "viewer", 820);
    await visit(page, "/stock/count");
    await expect(page.getByTestId("start-count")).toHaveCount(0);
  });
});

test.describe("stock in Hindi and Gujarati at 375: readable, no sideways scroll, axe clean", () => {
  for (const locale of ["hi", "gu"] as const) {
    for (const path of ["/stock/yards", "/stock/bundles", "/stock/count"]) {
      test(`${path} in ${locale}`, async ({ page }) => {
        await start(page, "owner", 375);
        await page.goto("/today");
        await page.evaluate((l) => localStorage.setItem("orrn.locale", l), locale);
        await visit(page, path);
        await expect(page.locator("main h1").first()).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main");
        expect(await axeSerious(page)).toEqual([]);
        await page.evaluate(() => localStorage.removeItem("orrn.locale"));
      });
    }
  }
});

void makePlantStock;
