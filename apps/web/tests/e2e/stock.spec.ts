import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * Stock (Task 21): Sections, a section, All bundles and the bundle page,
 * against the dev seed (120 bundles in 8 packing sessions, 3 void, one held
 * dispatch, one draft). Counts are compared with the API at the same moment,
 * so a parallel spec that adds stock can't make this one flaky.
 */

type Scheme = "light" | "dark";
type Summary = { items: { dieId: string; bundleCount: number | string; totalWeightG: number | string }[] };
type BundleRow = { id: string; serial: string; status: string };

async function open(page: Page, path: string, opts: { width: number; scheme?: Scheme; role?: LocalRole; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page
    .context()
    .request.get(`${API_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, {
      headers: { origin: WEB_ORIGIN },
    });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return (await res.json()).result.data as T;
}

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
  test("one block per section in stock, each showing the seeded bundle count", async ({ page }) => {
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
    }
    // The held dispatch's sections carry a blue "held" chip.
    for (const row of reserved.items) {
      const block = page.locator(`[data-testid='section-block'][data-die-id='${row.dieId}']`);
      await expect(block.locator("[data-slot='chip'][data-tone='blue']")).toContainText(`${Number(row.bundleCount)} held`);
    }

    const totalBundles = available.items.reduce((t, r) => t + Number(r.bundleCount), 0);
    await expect(page.getByTestId("stock-totals")).toContainText(`${totalBundles.toLocaleString("en-IN")} bundles`);
    await expectNoGrams(page);
  });

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
    await first.click();
    await expect(page).toHaveURL(/\/stock\/[^/?]+$/);
    await expect(page.getByTestId("section-hero").locator("[data-slot='big-number']")).toHaveText(count);
    await expect(page.getByRole("button", { name: "In stock", pressed: true })).toBeVisible();
    const rows = page.getByRole("list", { name: /^Bundles of / }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();
    for (const text of (await rows.allInnerTexts()).slice(0, 10)) expect(text).toContain("In stock");
    await expectNoGrams(page);
    await expectNoHorizontalScroll(page);
  });

  test("charts are for analytics roles only", async ({ page, browser }) => {
    await open(page, "/stock", { width: 1280 });
    await expect(page.getByTestId("chart-stock-age")).toBeVisible();
    await expect(page.getByTestId("chart-top-sections")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Stock age" })).toBeVisible();

    const operator = await browser.newPage();
    await open(operator, "/stock", { width: 1280, role: "operator" });
    await expect(operator.getByTestId("section-block").first()).toBeVisible();
    await expect(operator.getByTestId("stock-charts")).toHaveCount(0);
    await operator.close();
  });

  test("on a phone the sections come first and the charts follow them (reading order = screen order)", async ({
    page,
  }) => {
    await open(page, "/stock", { width: 390 });
    await expect(page.getByTestId("chart-stock-age")).toBeVisible();
    const gridFirst = await page.evaluate(() => {
      const grid = document.querySelector("[data-testid='section-grid']");
      const charts = document.querySelector("[data-testid='stock-charts']");
      return !!grid && !!charts && !!(grid.compareDocumentPosition(charts) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(gridFirst).toBe(true);
  });
});

test.describe("All bundles", () => {
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
});

test.describe("Void and restore", () => {
  // These change bundle statuses: run in order so the void count is checked before the round trip.
  test.describe.configure({ mode: "serial" });

  test("the Void chip shows the 3 seeded void bundles", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 1280 });
    await page.getByRole("button", { name: "Void", exact: true }).click();
    await expect(page).toHaveURL(/status=void/);
    const table = page.getByRole("table", { name: "Bundles" });
    await expect(table.locator("tbody tr")).toHaveCount(3);
    for (const text of await table.locator("tbody tr").allInnerTexts()) expect(text).toContain("Void");
  });

  test("void needs a reason, then restore brings the bundle back", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 390 });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 20 });
    const target = list.items[list.items.length - 1]!;
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
  });
});

test.describe("Bundle page", () => {
  test("facts in kg and the company unit, history from status events", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 1280 });
    const held = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "reserved", limit: 1 });
    await page.goto(`/b/${held.items[0]!.serial}`);
    const hero = page.getByTestId("bundle-hero");
    await expect(hero).toHaveAttribute("data-status", "reserved");
    // A held bundle links to its dispatch from the hero and the history.
    await expect(hero.getByRole("link", { name: /^In dispatch / })).toBeVisible();
    const facts = page.getByTestId("bundle-facts");
    await expect(facts.locator("[data-fact='weight'] dd")).toHaveText(/^\d[\d,]*\.\d{2} kg$/);
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
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 40 });
    const target = list.items[list.items.length - 2]!;
    await page.goto(`/b/${target.serial}`);
    await page.getByRole("button", { name: "Add to dispatch" }).click();
    const sheet = page.getByRole("dialog", { name: "Add to dispatch" });
    const choices = sheet.getByRole("list", { name: "Choose a dispatch" }).getByRole("button");
    await expect(choices.first()).toBeVisible();
    const code = (await choices.first().locator(".font-mono").innerText()).trim();
    await choices.first().click();
    await expect(sheet).toBeHidden();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: new RegExp(`(Added to|Already in) ${code}`) }),
    ).toBeVisible();
  });

  test("a viewer sees the bundle but none of the actions", async ({ page }) => {
    await open(page, "/stock/bundles", { width: 1280, role: "viewer" });
    const list = await trpcQuery<{ items: BundleRow[] }>(page, "bundle.listBundles", { status: "available", limit: 1 });
    await page.goto(`/b/${list.items[0]!.serial}`);
    await expect(page.getByTestId("bundle-hero")).toBeVisible();
    for (const name of ["Add to dispatch", "Reprint label", "Void bundle"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
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
    for (const width of [390, 1280]) {
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
        await expect(page.getByRole("dialog", { name: "Void this bundle?" })).toBeVisible();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${dir}/bundle-void-dialog-${width}-${scheme}.png` });
      }
    });
  }
});
