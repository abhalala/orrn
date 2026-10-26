import AxeBuilder from "@axe-core/playwright";
import { formatKg, formatKgTotal } from "@orrn/domain";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { packPlantStock } from "./helpers/plant-stock";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * Stock (Task 21): Sections, a section, All bundles and the bundle page,
 * against the dev seed (120 bundles in 8 packing sessions, 3 void, one held
 * dispatch, one draft). Counts are compared with the API at the same moment,
 * so a parallel spec that adds stock can't make this one flaky.
 */

type Scheme = "light" | "dark";
type Summary = {
  items: {
    dieId: string;
    dieSeries: string;
    dieSectionCode: string;
    bundleCount: number | string;
    totalWeightG: number | string;
  }[];
};
type BundleRow = {
  id: string;
  serial: string;
  status: string;
  dieId: string;
  dieSeries: string;
  dieSectionCode: string;
  groupId: string;
  groupCode: string;
};
type Ageing = {
  buckets: { key: string; kgG: number }[];
  topSections: { sectionId: string | null; kgG: number }[];
};

async function open(page: Page, path: string, opts: { width: number; scheme?: Scheme; role?: LocalRole; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function trpcQuery<T>(page: Page, path: string, input?: unknown): Promise<T> {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await page.context().request.get(`${API_URL}/trpc/${path}${query}`, { headers: { origin: WEB_ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function trpcMutation<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

/** Puts a bundle back in stock after a test that voided it, even when the test failed half way. */
async function restoreIfVoid(page: Page, serial: string) {
  const now = await trpcQuery<{ bundle: { id: string; status: string } }>(page, "bundle.getBySerial", { serial });
  if (now.bundle.status === "void") {
    await trpcMutation(page, "bundle.transitionStatus", { id: now.bundle.id, toStatus: "available", reason: null });
  }
}

/** Keyboard only: press Tab until `target` has focus (fails if it never does). */
async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
  await expect(target).toBeVisible();
}

/** Every Void/Restore answers FORBIDDEN (a role changed under the page); nothing reaches the server. */
async function refuseTransitions(page: Page) {
  await page.route("**/trpc/bundle.transitionStatus*", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify([
        { error: { message: "Forbidden", code: -32003, data: { code: "FORBIDDEN", httpStatus: 403, path: "bundle.transitionStatus" } } },
      ]),
    }),
  );
}

/** The kg a server weight in grams must read as, on any stock screen. */
const kgTotal = (grams: number | string) => `${formatKgTotal(Number(grams) / 1000)} kg`;
/** A chart value: an empty bucket reads "0 kg". */
const chartKg = (grams: number) => (grams === 0 ? "0 kg" : kgTotal(grams));

async function seriousViolations(page: Page) {
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

/** Spec rule: weights always in kg. No "52 g", "52400 g" anywhere on the page. */
async function expectNoGrams(page: Page) {
  await expect(page.getByText(/\d g\b/)).toHaveCount(0);
}

test.describe("Sections", () => {
  test("search narrows the blocks; sort A to Z orders them by section", async ({ page }) => {
    await open(page, "/stock", { width: 1280 });
    await expect(page.getByTestId("section-block").first()).toBeVisible();
    await page.getByLabel("Search die or section").fill("angle");
    const blocks = page.getByTestId("section-block");
    await expect(blocks.first()).toBeVisible();
    for (const text of await blocks.allInnerTexts()) expect(text.toLowerCase()).toContain("angle");

    await page.getByLabel("Search die or section").fill("no such section");
    await expect(page.getByText('Nothing matches "no such section"')).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(blocks.first()).toBeVisible();

    await page.getByRole("radio", { name: "A to Z" }).click();
    const titles = await blocks.evaluateAll((els) => els.map((el) => el.querySelector("span span")?.textContent ?? ""));
    const sorted = [...titles].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
    expect(titles).toEqual(sorted);
  });

  test("a block opens its section: in stock first, the hero matches the block", async ({ page }) => {
    await open(page, "/stock", { width: 390 });
    const first = page.locator("[data-testid='section-block'][data-tone='green']").first();
    const count = await first.locator("[data-slot='big-number']").innerText();
    const kg = (await first.getByText(/^[\d,]+\.\d kg$/).innerText()).trim();
    await first.click();
    await expect(page).toHaveURL(/\/stock\/[^/?]+$/);
    const hero = page.getByTestId("section-hero");
    await expect(hero.locator("[data-slot='big-number']")).toHaveText(count);
    await expect(hero).toContainText(kg);
    await expect(page.getByRole("button", { name: "In stock", pressed: true })).toBeVisible();
    const rows = page.getByRole("list", { name: /^Bundles of / }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    for (const text of (await rows.allInnerTexts()).slice(0, 10)) expect(text).toContain("In stock");
    await expectNoGrams(page);
    await expectNoHorizontalScroll(page);
  });

  test("a section with nothing on the floor says so, and its list doesn't blame a status", async ({ page }) => {
    await open(page, "/stock", { width: 1280 });
    // A die with no bundle in any status.
    const withBundles = new Set<string>();
    for (const status of ["available", "reserved", "dispatched", "void"]) {
      const s = await trpcQuery<Summary>(page, "bundle.stockSummary", { status });
      for (const r of s.items) withBundles.add(r.dieId);
    }
    const dies = await trpcQuery<{ items: { id: string }[] }>(page, "die.list", { limit: 100 });
    const emptyDie = dies.items.find((d) => !withBundles.has(d.id))?.id;
    test.skip(!emptyDie, "the seed has no die without bundles");
    await page.goto(`/stock/${emptyDie}`);
    const hero = page.getByTestId("section-hero");
    await expect(hero).toHaveAttribute("data-tone", "neutral");
    await expect(hero).toContainText("Nothing on the floor");
    await expect(hero).not.toContainText("in stock");
    await expect(page.getByRole("button", { name: "All", pressed: true })).toBeVisible();
    await expect(page.getByText("No bundles packed for this section yet.")).toBeVisible();
    await expect(page.getByText("No bundles with this status.")).toHaveCount(0);
  });

  test("charts are for analytics roles only", async ({ page, browser }) => {
    await open(page, "/stock", { width: 1280 });
    await expect(page.getByTestId("chart-stock-age")).toBeVisible();
    await expect(page.getByTestId("chart-top-sections")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stock age" })).toBeVisible();
    await expect(page.getByTestId("chart-top-sections")).toContainText("kg in stock per section, top 8 and the rest");

    const operator = await browser.newPage();
    await open(operator, "/stock", { width: 1280, role: "operator" });
    await expect(operator.getByTestId("section-block").first()).toBeVisible();
    await expect(operator.getByTestId("stock-charts")).toHaveCount(0);
    await operator.close();
  });

  for (const width of [390, 1280]) {
    test(`at ${width} the sections come first and the charts follow them (reading order = screen order)`, async ({
      page,
    }) => {
      await open(page, "/stock", { width });
      await expect(page.getByTestId("chart-stock-age")).toBeVisible();
      const gridFirst = await page.evaluate(() => {
        const grid = document.querySelector("[data-testid='section-grid']");
        const charts = document.querySelector("[data-testid='stock-charts']");
        return !!grid && !!charts && !!(grid.compareDocumentPosition(charts) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(gridFirst).toBe(true);
    });
  }

  test("if the chart code fails to download, the sections still work", async ({ page }) => {
    await page.route("**/stock-charts*", (route) => route.abort());
    await open(page, "/stock", { width: 1280 });
    await expect(page.getByTestId("section-block").first()).toBeVisible();
    await expect(page.getByText("Charts didn't load. Check the connection, then try again.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Stock" })).toBeVisible();
    await page.unroute("**/stock-charts*");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("chart-stock-age")).toBeVisible();
  });
});

/**
 * Tests that read stock numbers and tests that change them, in one worker and
 * in this order, so a void or a new bundle never lands between a screen and
 * the API read it is compared with.
 */
test.describe("Stock numbers and changes", () => {
  test.describe.configure({ mode: "serial" });

  test("one block per section, with the server's bundle count and kg; totals in kg", async ({ page }) => {
    await open(page, "/stock", { width: 1280 });
    const available = await trpcQuery<Summary>(page, "bundle.stockSummary", { status: "available" });
    const reserved = await trpcQuery<Summary>(page, "bundle.stockSummary", { status: "reserved" });
    const dies = new Set([...available.items, ...reserved.items].map((r) => r.dieId));

    const blocks = page.getByTestId("section-block");
    await expect(blocks).toHaveCount(dies.size);
    for (const row of available.items) {
      const block = page.locator(`[data-testid='section-block'][data-die-id='${row.dieId}']`);
      await expect(block.locator("[data-slot='big-number']")).toHaveText(String(Number(row.bundleCount)));
      await expect(block).toHaveAttribute("data-tone", "green");
      // The kg is the server's grams / 1000: a dropped conversion would read 1,000 times bigger.
      await expect(block.getByText(kgTotal(row.totalWeightG), { exact: true })).toBeVisible();
    }
    // The held dispatch's sections carry a blue "held" chip.
    for (const row of reserved.items) {
      const block = page.locator(`[data-testid='section-block'][data-die-id='${row.dieId}']`);
      await expect(block.locator("[data-slot='chip'][data-tone='blue']")).toContainText(`${Number(row.bundleCount)} held`);
    }

    const totalBundles = available.items.reduce((t, r) => t + Number(r.bundleCount), 0);
    const totalG = available.items.reduce((t, r) => t + Number(r.totalWeightG), 0);
    await expect(page.getByTestId("stock-totals")).toContainText(
      `${totalBundles.toLocaleString("en-IN")} bundles · ${kgTotal(totalG)} in stock`,
    );
    // Held kg is on screen too, so in stock + held reconciles with the charts (which count both).
    const heldBundles = reserved.items.reduce((t, r) => t + Number(r.bundleCount), 0);
    const heldG = reserved.items.reduce((t, r) => t + Number(r.totalWeightG), 0);
    if (heldBundles > 0) {
      await expect(page.getByTestId("stock-totals").locator("[data-slot='chip'][data-tone='blue']")).toHaveText(
        `${heldBundles.toLocaleString("en-IN")} held, ${kgTotal(heldG)}`,
      );
    }
    await expectNoGrams(page);

    // A section with stock and held bundles: its hero names the held kg beside the in-stock kg.
    const mixed = reserved.items.find((r) => available.items.some((a) => a.dieId === r.dieId));
    if (mixed) {
      const free = available.items.find((a) => a.dieId === mixed.dieId)!;
      await page.goto(`/stock/${mixed.dieId}`);
      await expect(page.getByTestId("section-hero")).toContainText(
        `${kgTotal(free.totalWeightG)} · ${Number(mixed.bundleCount)} held, ${kgTotal(mixed.totalWeightG)}`,
      );
      await expectNoGrams(page);
    }
  });

  test("chart tables show the server's stock age and top sections", async ({ page }) => {
    await open(page, "/stock", { width: 1280 });
    const ageing = await trpcQuery<Ageing>(page, "analytics.stockAgeing");

    const age = page.getByTestId("chart-stock-age");
    await age.getByRole("button", { name: "Show table" }).click();
    const ageRows = age.getByRole("table").locator("tbody tr");
    await expect(ageRows).toHaveCount(ageing.buckets.length);
    for (const [i, b] of ageing.buckets.entries()) {
      await expect(ageRows.nth(i).locator("th")).toHaveText(`${b.key} days`);
      await expect(ageRows.nth(i).locator("td")).toHaveText(chartKg(b.kgG));
    }

    const top = page.getByTestId("chart-top-sections");
    await top.getByRole("button", { name: "Show table" }).click();
    const named = ageing.topSections.filter((s) => s.sectionId !== null);
    const other = ageing.topSections.find((s) => s.sectionId === null);
    const topRows = top.getByRole("table").locator("tbody tr");
    await expect(topRows).toHaveCount(named.length + (other && other.kgG > 0 ? 1 : 0));
    // Columns: section (row header), rank, kg, share.
    for (const [i, s] of named.entries()) await expect(topRows.nth(i).locator("td").nth(1)).toHaveText(chartKg(s.kgG));
    if (other && other.kgG > 0) await expect(topRows.last().locator("td").nth(1)).toHaveText(chartKg(other.kgG));
  });

  test("pages through every bundle 50 at a time", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 1280 });
    const all = await trpcQuery<{ total: number }>(page, "bundle.listBundles", { limit: 1 });
    const total = Number(all.total);
    expect(total).toBeGreaterThan(50);
    const table = page.getByRole("table", { name: "Bundles" });
    await expect(table.locator("tbody tr")).toHaveCount(50);
    await expect(page.getByText(`1-50 of ${total.toLocaleString("en-IN")}`)).toBeVisible();

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText(`51-${Math.min(100, total)} of ${total.toLocaleString("en-IN")}`)).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(Math.min(50, total - 50));
    await expectNoGrams(page);
  });

  test("the Void chip shows the void bundles (3 in the seed)", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 1280 });
    await page.getByRole("button", { name: "Void", exact: true }).click();
    await expect(page).toHaveURL(/status=void/);
    const voids = await trpcQuery<{ total: number }>(page, "bundle.listBundles", { status: "void", limit: 1 });
    expect(Number(voids.total)).toBeGreaterThan(0);
    const table = page.getByRole("table", { name: "Bundles" });
    await expect(table.locator("tbody tr")).toHaveCount(Math.min(50, Number(voids.total)));
    for (const text of await table.locator("tbody tr").allInnerTexts()) expect(text).toContain("Void");
  });

  test("void needs a reason, then restore brings the bundle back", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 390 });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 20 });
    const target = list.items[list.items.length - 1]!;
    try {
      await page.goto(`/b/${target.serial}`);
      const hero = page.getByTestId("bundle-hero");
      await expect(hero).toHaveAttribute("data-status", "available");
      await expect(page.getByRole("heading", { level: 1, name: `Bundle ${target.serial}` })).toBeVisible();
      await expectNoGrams(page);

      await page.getByRole("button", { name: "Void bundle" }).click();
      const dialog = page.getByRole("dialog", { name: "Void this bundle?" });
      await dialog.getByRole("button", { name: "Void bundle" }).click();
      await expect(dialog.getByText("Write why this bundle is void.")).toBeVisible();
      await dialog.getByLabel("Reason").fill("Packed twice in e2e");
      await dialog.getByRole("button", { name: "Void bundle" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Bundle voided" })).toBeVisible();
      await expect(hero).toHaveAttribute("data-status", "void");
      await expect(page.getByTestId("bundle-status")).toHaveText("Void");
      const history = page.getByTestId("bundle-timeline");
      await expect(history.locator("li").first()).toContainText("Voided");
      await expect(history.locator("li").first()).toContainText("Reason: Packed twice in e2e");
      // A void bundle can't go into a dispatch.
      await expect(page.getByRole("button", { name: "Add to dispatch" })).toHaveCount(0);

      await page.getByRole("button", { name: "Restore bundle" }).click();
      const restore = page.getByRole("dialog", { name: "Restore this bundle?" });
      await restore.getByRole("button", { name: "Restore bundle" }).click();
      await expect(restore).toBeHidden();
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Bundle restored" })).toBeVisible();
      await expect(hero).toHaveAttribute("data-status", "available");
      await expect(history.locator("li").first()).toContainText("Restored");

      const after = await trpcQuery<{ bundle: { status: string } }>(page, "bundle.getBySerial", { serial: target.serial });
      expect(after.bundle.status).toBe("available");
    } finally {
      await restoreIfVoid(page, target.serial);
    }
  });

  test("keyboard only: Tab to Void, a reason, Enter; Escape closes Restore; focus stays on the action", async ({
    page,
  }) => {
    await open(page, "/stock/bundles", { width: 1280 });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 20 });
    const target = list.items[list.items.length - 5]!;
    try {
      await page.goto(`/b/${target.serial}`);
      const hero = page.getByTestId("bundle-hero");
      await expect(hero).toHaveAttribute("data-status", "available");

      await tabTo(page, page.getByRole("button", { name: "Void bundle" }));
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Void this bundle?" });
      const reason = dialog.getByLabel("Reason");
      await expect(reason).toBeFocused();

      // Enter in the empty field: focus is already there, so a polite live line says what is missing.
      await page.keyboard.press("Enter");
      await expect(dialog.locator("[aria-live='polite']")).toHaveText("Write why this bundle is void.");
      await expect(reason).toBeFocused();

      // Void with no reason, from the button: focus goes to the field, which now carries the error.
      await tabTo(page, dialog.getByRole("button", { name: "Void bundle" }));
      await page.keyboard.press("Enter");
      await expect(reason).toBeFocused();
      await expect(reason).toHaveAttribute("aria-invalid", "true");
      await expect(reason).toHaveAccessibleDescription(/Write why this bundle is void\./);
      await expect(hero).toHaveAttribute("data-status", "available");

      // A reason, then Enter in the field voids it. Focus comes back to the same action, now Restore.
      await page.keyboard.type("Wrong weight, keyboard e2e");
      await page.keyboard.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(hero).toHaveAttribute("data-status", "void");
      const restoreButton = page.getByRole("button", { name: "Restore bundle" });
      await expect(restoreButton).toBeFocused();

      // Escape closes Restore and changes nothing; focus comes back.
      await page.keyboard.press("Enter");
      const restore = page.getByRole("dialog", { name: "Restore this bundle?" });
      await expect(restore).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(restore).toBeHidden();
      await expect(restoreButton).toBeFocused();
      await expect(hero).toHaveAttribute("data-status", "void");

      // Restore's reason is optional: Enter in the empty field restores.
      await page.keyboard.press("Enter");
      await expect(restore.getByLabel(/^Reason/)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(restore).toBeHidden();
      await expect(hero).toHaveAttribute("data-status", "available");
      await expect(page.getByRole("button", { name: "Void bundle" })).toBeFocused();
    } finally {
      await restoreIfVoid(page, target.serial);
    }
  });

  test("a die deleted with stock on the floor still opens its section and bundles", async ({ page }) => {
    await open(page, "/stock", { width: 1280 });
    const code = `DEL${Date.now() % 1_000_000}`;
    await trpcMutation(page, "bundle.bulkImport", {
      rows: [1, 2, 3].map((i) => ({ dieSeries: "E2E", dieSectionCode: code, quantity: 10, weightG: 50_000 + i * 100, lengthMm: 3658 })),
    });
    const available = await trpcQuery<Summary>(page, "bundle.stockSummary", { status: "available" });
    const row = available.items.find((r) => r.dieSeries === "E2E" && r.dieSectionCode === code);
    expect(row, "the imported section is in stock").toBeTruthy();
    await trpcMutation(page, "die.delete", { id: row!.dieId });

    await page.goto("/stock");
    await page.locator(`[data-testid='section-block'][data-die-id='${row!.dieId}']`).click();
    await expect(page).toHaveURL(new RegExp(`/stock/${row!.dieId}$`));
    await expect(page.getByRole("heading", { level: 1, name: `E2E ${code}` })).toBeVisible();
    await expect(page.getByTestId("section-hero").locator("[data-slot='big-number']")).toHaveText("3");
    const table = page.getByRole("table", { name: `Bundles of E2E ${code}` });
    await expect(table.locator("tbody tr")).toHaveCount(3);
    // The die has no page any more, and nothing says "Not found".
    await expect(page.getByRole("link", { name: "Die details" })).toHaveCount(0);
    await expect(page.getByText("Not found in this company")).toHaveCount(0);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

    // A bundle's Section link gets back there too.
    await table.locator("tbody tr").first().getByRole("link").click();
    await expect(page).toHaveURL(/\/b\//);
    await page.getByTestId("bundle-facts").locator("[data-fact='section'] a").click();
    await expect(page.getByRole("heading", { level: 1, name: `E2E ${code}` })).toBeVisible();
  });
});

test.describe("All bundles", () => {
  test("search finds a serial and keeps it in the URL", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 390 });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 5 });
    const serial = list.items[0]!.serial;
    await page.getByLabel("Search serial or PO").fill(serial);
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(serial)}`));
    const rows = page.getByRole("list", { name: "Bundles" }).getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(serial);
    await rows.first().getByRole("link", { name: serial }).click();
    await expect(page).toHaveURL(new RegExp(`/b/${serial}$`));
  });

  test("a page past the end lands on the last page, with a way back", async ({ page }) => {
    await open(page, "/stock/bundles?page=9", { width: 1280 });
    const all = await trpcQuery<{ total: number }>(page, "bundle.listBundles", { limit: 1 });
    const last = Math.ceil(Number(all.total) / 50);
    await expect(page).toHaveURL(new RegExp(`page=${last}`));
    await expect(page.getByRole("table", { name: "Bundles" }).locator("tbody tr").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous page" })).toBeEnabled();

    const s = await trpcQuery<Summary>(page, "bundle.stockSummary", { status: "available" });
    // Earlier specs pack bundles on the first section, so its bundle count is not fixed: the page
    // lands on the section's own last page (page 1 drops the parameter).
    const dieId = s.items[0]!.dieId;
    const ofDie = await trpcQuery<{ total: number }>(page, "bundle.listBundles", { dieId, limit: 1 });
    const dieLast = Math.ceil(Number(ofDie.total) / 50);
    expect(dieLast, "the section has fewer than 7 pages").toBeLessThan(7);
    await page.goto(`/stock/${dieId}?status=all&page=7`);
    if (dieLast <= 1) await expect(page).not.toHaveURL(/page=/);
    else await expect(page).toHaveURL(new RegExp(`page=${dieLast}(&|$)`));
    await expect(page.getByRole("table", { name: /^Bundles of / }).locator("tbody tr").first()).toBeVisible();
  });

  test("an old /bundles link names the section or packing session it shows", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 1280 });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 1 });
    const b = list.items[0]!;
    await page.goto(`/stock/bundles?dieId=${b.dieId}`);
    await expect(page.getByText(`Showing ${b.dieSeries} ${b.dieSectionCode}`, { exact: true })).toBeVisible();
    await page.goto(`/stock/bundles?groupId=${b.groupId}`);
    await expect(page.getByText(`Showing packing session ${b.groupCode}`, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show all bundles" }).click();
    await expect(page).not.toHaveURL(/groupId=/);
  });
});

test.describe("Bundle page", () => {
  test("facts in kg and the company unit, history from status events", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 1280 });
    const held = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "reserved", limit: 1 });
    const serial = held.items[0]!.serial;
    const detail = await trpcQuery<{ bundle: { weightG: number } }>(page, "bundle.getBySerial", { serial });
    await page.goto(`/b/${serial}`);
    const hero = page.getByTestId("bundle-hero");
    await expect(hero).toHaveAttribute("data-status", "reserved");
    // A held bundle links to its dispatch from the hero and the history.
    await expect(hero.getByRole("link", { name: /^In dispatch / })).toBeVisible();
    const facts = page.getByTestId("bundle-facts");
    // The server's grams / 1000, exactly: "52.40 kg", never "52,400.00 kg".
    await expect(facts.locator("[data-fact='weight'] dd")).toHaveText(`${formatKg(detail.bundle.weightG / 1000)} kg`);
    await expect(facts.locator("[data-fact='kg12'] dd")).toContainText(/\d\.\d{2}/);
    const history = page.getByTestId("bundle-timeline");
    await expect(history.locator("li[data-kind='held']")).toHaveCount(1);
    await expect(history.locator("li").last()).toHaveAttribute("data-kind", "packed");
    // Held stock can't be voided from here.
    await expect(page.getByRole("button", { name: "Void bundle" })).toHaveCount(0);
    await expectNoGrams(page);
  });

  test("Add to dispatch lists the dispatches being built and adds with one tap", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 390 });
    // Packed as "Plant stock" (D20): the add paths take it; stock for no order would be refused (D12).
    const [target] = await packPlantStock(page, 1);
    let code: string | null = null;
    try {
      await page.goto(`/b/${target.serial}`);
      await page.getByRole("button", { name: "Add to dispatch" }).click();
      const sheet = page.getByRole("dialog", { name: "Add to dispatch" });
      const choices = sheet.getByRole("list", { name: "Choose a dispatch" }).getByRole("button");
      await expect(choices.first()).toBeVisible();
      code = (await choices.first().locator(".font-mono").innerText()).trim();
      await choices.first().click();
      await expect(sheet).toBeHidden();
      await expect(
        page.locator("[data-sonner-toast]").filter({ hasText: new RegExp(`(Added to|Already in) ${code}`) }),
      ).toBeVisible();
    } finally {
      // The seeded draft is shared with the dispatch specs: take the bundle back out.
      if (code) {
        const drafts = await trpcQuery<{ items: { id: string; code: string }[] }>(page, "dispatch.listDispatches", {
          status: "draft",
          limit: 50,
        });
        const draft = drafts.items.find((d) => d.code === code);
        if (draft) {
          await page
            .context()
            .request.post(`${API_URL}/trpc/dispatch.removeBundle`, {
              headers: { origin: WEB_ORIGIN },
              data: { id: draft.id, bundleId: target.id },
            });
        }
      }
    }
  });

  test("Reprint label with no printer set up says how to fix it", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 1280 });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "reserved", limit: 1 });
    await page.goto(`/b/${list.items[0]!.serial}`);
    await page.getByRole("button", { name: "Reprint label" }).click();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: "No label printer is set up. Ask your admin to connect one in Printing." }),
    ).toBeVisible();
  });

  test("a viewer sees the bundle but none of the actions, and no empty action group", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 1280, role: "viewer" });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 1 });
    await page.goto(`/b/${list.items[0]!.serial}`);
    await expect(page.getByTestId("bundle-hero")).toBeVisible();
    for (const name of ["Add to dispatch", "Reprint label", "Void bundle"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await expect(page.getByRole("group", { name: "Bundle actions" })).toHaveCount(0);
  });

  test("the Void dialog: a missing reason moves focus to the field; a refusal is a dialog message", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 390 });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 30 });
    await page.goto(`/b/${list.items[list.items.length - 3]!.serial}`);
    await page.getByRole("button", { name: "Void bundle" }).click();
    const dialog = page.getByRole("dialog", { name: "Void this bundle?" });
    const reason = dialog.getByLabel("Reason");
    await dialog.getByRole("button", { name: "Void bundle" }).click();
    await expect(reason).toBeFocused();
    await expect(reason).toHaveAccessibleDescription(/Write why this bundle is void\./);

    // The server refuses (role changed): say so for the whole dialog, not as a problem with the reason.
    await refuseTransitions(page);
    await reason.fill("Packed twice");
    await dialog.getByRole("button", { name: "Void bundle" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Your role can't do this. Ask your admin.");
    await expect(reason).not.toHaveAttribute("aria-invalid", "true");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("bundle-hero")).toHaveAttribute("data-status", "available");
  });

  for (const width of [375, 820]) {
    test(`on touch at ${width} the Section and Packing session links are at least 44 px tall`, async ({ browser }) => {
      // A fresh touch context per check: Chromium reports pointer: coarse only on a context's first document.
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true, isMobile: true });
      const page = await context.newPage();
      try {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await signInViaApi(page, "owner");
        const held = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "reserved", limit: 1 });
        await page.goto(`${WEB_ORIGIN}/b/${held.items[0]!.serial}`);
        await expect(page.getByTestId("bundle-facts")).toBeVisible();
        expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
        for (const fact of ["section", "session"]) {
          const box = await page.getByTestId("bundle-facts").locator(`[data-fact='${fact}'] a`).boundingBox();
          expect(box, `${fact} link`).not.toBeNull();
          expect(box!.height, `${fact} link height`).toBeGreaterThanOrEqual(44);
        }
      } finally {
        await context.close();
      }
    });
  }
});

test.describe("Scan or search palette", () => {
  test("part of a serial lists the matching bundles; Enter on one opens it", async ({ page }) => {
    await open(page, "/stock", { width: 1280 });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "reserved", limit: 1 });
    const serial = list.items[0]!.serial;
    const fragment = serial.slice(3);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Scan or search" });
    const input = palette.getByRole("combobox");
    await expect(input).toBeFocused();
    await input.fill(fragment);
    const option = palette.getByRole("option", { name: new RegExp(serial) });
    await expect(option).toBeVisible();
    for (let i = 0; i < 10; i += 1) {
      const active = await input.getAttribute("aria-activedescendant");
      if (active && (await palette.locator(`[id="${active}"]`).textContent())?.includes(serial)) break;
      await input.press("ArrowDown");
    }
    await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/b/${serial}$`));
  });
});

test.describe("layout and accessibility", () => {
  const screens: { name: string; path: (page: Page) => Promise<string> }[] = [
    { name: "sections", path: async () => "/stock" },
    { name: "bundles", path: async () => "/stock/bundles" },
    {
      name: "section",
      path: async (page) => {
        const s = await trpcQuery<Summary>(page, "bundle.stockSummary", { status: "available" });
        return `/stock/${s.items[0]!.dieId}`;
      },
    },
    {
      name: "bundle",
      path: async (page) => {
        const l = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "reserved", limit: 1 });
        return `/b/${l.items[0]!.serial}`;
      },
    },
  ];

  for (const screen of screens) {
    for (const width of [390, 820, 1280]) {
      for (const scheme of ["light", "dark"] as const) {
        test(`${screen.name} at ${width} ${scheme}: no sideways scroll, no clipped text, no serious axe issues`, async ({
          page,
        }) => {
          await open(page, "/stock", { width, scheme });
          await page.goto(await screen.path(page));
          await expect(page.locator("main#main h1").first()).toBeVisible();
          // Let lists, blocks and lazy charts settle before measuring.
          await page.waitForLoadState("networkidle");
          await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
          await expectNoHorizontalScroll(page);
          await expectNoClippedText(page);
          expect(await seriousViolations(page)).toEqual([]);
        });
      }
    }
  }
});

test.describe("Hindi", () => {
  test("sections, a section and a bundle in Hindi at 375: nothing clipped, no sideways scroll, Latin digits", async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
    await open(page, "/stock", { width: 375 });
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByTestId("section-block").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page);
    await expect(page.getByTestId("section-block").first().locator("[data-slot='big-number']")).toHaveText(/^\d+$/);

    const s = await trpcQuery<Summary>(page, "bundle.stockSummary", { status: "available" });
    await page.goto(`/stock/${s.items[0]!.dieId}`);
    await expect(page.getByTestId("section-hero")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page);

    const l = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "reserved", limit: 1 });
    await page.goto(`/b/${l.items[0]!.serial}`);
    await expect(page.getByTestId("bundle-hero")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page);
    if (process.env.T21_SHOTS_DIR) {
      await page.screenshot({ path: `${process.env.T21_SHOTS_DIR}/bundle-held-375-light-hi.png`, fullPage: true });
    }
  });
});

/**
 * Screenshots for the task report: every screen at 375 and 1280, light and
 * dark. Only when T21_SHOTS_DIR is set (they are review material, not a test).
 */
test.describe("screenshots", () => {
  const dir = process.env.T21_SHOTS_DIR;
  test.skip(!dir, "set T21_SHOTS_DIR to capture");
  // Six full-page captures (plus a sheet and a dialog on phones) in one test.
  test.setTimeout(150_000);

  // 375 and 1280 in both themes (the report's set), plus the iPad rail at 820 in light.
  const sets = [
    ...[375, 1280].flatMap((width) => (["light", "dark"] as const).map((scheme) => ({ width, scheme }))),
    { width: 820, scheme: "light" as const },
  ];
  for (const { width, scheme } of sets) {
    test(`capture ${width} ${scheme}`, async ({ page }) => {
      await open(page, "/stock", { width, scheme });
      const shot = async (name: string) => {
        await page.waitForLoadState("networkidle");
        await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
        await page.screenshot({ path: `${dir}/${name}-${width}-${scheme}.png`, fullPage: true });
      };
      await shot("stock-sections");
      const s = await trpcQuery<Summary>(page, "bundle.stockSummary", { status: "available" });
      await page.goto(`/stock/${s.items[0]!.dieId}`);
      await shot("stock-section");
      await page.goto("/stock/bundles");
      await shot("stock-bundles");
      const held = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "reserved", limit: 1 });
      await page.goto(`/b/${held.items[0]!.serial}`);
      await shot("bundle-held");
      const avail = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 1 });
      await page.goto(`/b/${avail.items[0]!.serial}`);
      await shot("bundle-available");
      const gone = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "void", limit: 1 });
      await page.goto(`/b/${gone.items[0]!.serial}`);
      await shot("bundle-void");
      if (width === 375) {
        await page.goto(`/b/${avail.items[0]!.serial}`);
        await page.getByRole("button", { name: "Add to dispatch" }).click();
        await expect(page.getByRole("dialog", { name: "Add to dispatch" })).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${dir}/bundle-add-sheet-${width}-${scheme}.png` });
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Void bundle" }).click();
        const dialog = page.getByRole("dialog", { name: "Void this bundle?" });
        await expect(dialog).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${dir}/bundle-void-dialog-${width}-${scheme}.png` });
        // No reason: the field error. A refusal: the dialog message (nothing is sent to the server).
        await dialog.getByRole("button", { name: "Void bundle" }).click();
        await expect(dialog.getByLabel("Reason")).toBeFocused();
        await page.screenshot({ path: `${dir}/bundle-void-reason-${width}-${scheme}.png` });
        await refuseTransitions(page);
        await dialog.getByLabel("Reason").fill("Packed twice");
        await dialog.getByRole("button", { name: "Void bundle" }).click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        await page.screenshot({ path: `${dir}/bundle-void-refused-${width}-${scheme}.png` });
      }
    });
  }
});
