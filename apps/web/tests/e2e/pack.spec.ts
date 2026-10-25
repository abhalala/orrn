import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { mockLabelPrinting } from "./helpers/mock-printing";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Pack (Task 20): `/pack`, `/pack/new`, `/pack/:id` against the local seed.
 * The demo company is an inch company (cut lengths in feet + inches) and has
 * no label printing connected, so the save button reads "Save session".
 *
 * Die 14701 (PATTI) has the range 2.4 to 2.6 kg/12ft. At 11 ft 6 in
 * (3505 mm), 20 pieces weighing 47.90 kg give 2.50 kg/12ft (in range);
 * 40.00 kg gives 2.09 (below range, amber).
 */

const API = API_URL;
const ORIGIN = WEB_ORIGIN;
const DIE = "14701";
/** A saved session's page (`/pack/<id>`), never `/pack/new` itself. */
const SESSION_URL = (url: URL) => /^\/pack\/[^/]+$/.test(url.pathname) && url.pathname !== "/pack/new";

type Scheme = "light" | "dark";

async function open(page: Page, path: string, opts: { width?: number; scheme?: Scheme; role?: LocalRole } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "operator");
  await page.goto(path);
  // A cold Vite (first test of a run on a loaded machine) can take longer than the 5 s default to paint.
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 20_000 });
}

async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page
    .context()
    .request.get(`${API}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, {
      headers: { origin: ORIGIN },
    });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return (await res.json()).result.data as T;
}

/** Press Tab (only the keyboard) until `target` has focus. */
async function tabTo(page: Page, target: Locator, max = 40) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
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

const weightField = (page: Page) => page.getByLabel("Weight (kg)", { exact: true });
const piecesField = (page: Page) => page.getByLabel("Pieces", { exact: true });
const savedRows = (page: Page) => page.locator("[data-slot='saved-bundle']");

const yardGroup = (page: Page) => page.getByRole("group", { name: "Yard" });
const yardTile = (page: Page, code: string) => yardGroup(page).getByRole("radio", { name: new RegExp(`^${code}\\b`) });

/** Step 1 by keyboard: search the die, Enter picks the single match, then 11 ft 6 in. */
async function chooseDieAndTypeLength(page: Page, feet = "11", inches = "6") {
  await tabTo(page, page.getByLabel("Search die code or section"));
  await page.keyboard.type(DIE);
  await expect(page.locator("button[data-die]")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Feet", { exact: true })).toBeFocused();
  await page.keyboard.type(feet);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Inches", { exact: true })).toBeFocused();
  await page.keyboard.type(inches);
}

/**
 * Step 1 by keyboard, yard included: Tab into the yard tiles (the seed company
 * has yards Y1 to Y6; a fresh browser has no last yard, so the first tile
 * takes focus), arrow keys choose, Enter moves on to Bundles.
 */
async function chooseDieAndLength(page: Page, feet = "11", inches = "6") {
  await chooseDieAndTypeLength(page, feet, inches);
  await page.keyboard.press("Tab");
  await expect(yardTile(page, "Y1")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(yardTile(page, "Y2")).toBeChecked();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Bundles" })).toBeVisible();
  await expect(weightField(page)).toBeFocused();
}

/** One bundle by keyboard: weight, Enter, pieces, Enter. */
async function typeBundle(page: Page, weight: string, pieces: string) {
  await expect(weightField(page)).toBeFocused();
  await page.keyboard.type(weight);
  await page.keyboard.press("Enter");
  await expect(piecesField(page)).toBeFocused();
  await page.keyboard.type(pieces);
  await page.keyboard.press("Enter");
}

test.describe("pack", () => {
  test("a 40-bundle session by keyboard only: amber chip, reload keeps the draft, 11 ft 6 in stores 3505 mm", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await open(page, "/pack/new");
    await chooseDieAndTypeLength(page);
    // Enter without a yard: the yard is asked for and focus goes to the first tile.
    await page.keyboard.press("Enter");
    await expect(yardGroup(page)).toContainText("Choose the yard these bundles go to.");
    await expect(yardTile(page, "Y1")).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(yardTile(page, "Y2")).toBeChecked();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Bundles" })).toBeVisible();
    await expect(weightField(page)).toBeFocused();
    await expect(page.getByTestId("session-yard")).toHaveText("Y2");

    // In range, then one below range: the live readout turns amber before saving, the row keeps an amber chip.
    for (let i = 1; i <= 6; i++) await typeBundle(page, `47.${90 + (i % 5)}`, "20");
    await expect(savedRows(page)).toHaveCount(6);
    await expect(savedRows(page).nth(0).locator("[data-verdict='in']")).toBeVisible();

    await page.keyboard.type("40");
    await page.keyboard.press("Enter");
    await page.keyboard.type("20");
    await expect(page.locator("[data-slot='live-k12']")).toHaveAttribute("data-tone", "amber");
    await expect(page.locator("[data-slot='live-k12']")).toContainText("Below range");
    await page.keyboard.press("Enter");
    await expect(savedRows(page)).toHaveCount(7);
    const amberRow = savedRows(page).nth(6);
    await expect(amberRow.locator("[data-verdict='below']")).toBeVisible();
    await expect(amberRow.locator("[data-verdict='below']")).toHaveText("Below range");
    // The save is announced politely.
    await expect(page.locator("[role='status'][aria-live='polite']").first()).toContainText("Bundle 7 saved");

    for (let i = 8; i <= 20; i++) await typeBundle(page, `47.${90 + (i % 5)}`, "20");
    await expect(savedRows(page)).toHaveCount(20);

    // Reload mid-session: the 20 drafted bundles come back, focus is on the next weight.
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "Bundles" })).toBeVisible();
    await expect(savedRows(page)).toHaveCount(20);
    await expect(page.getByText("Your unsaved bundles are still here.")).toBeVisible();
    await expect(weightField(page)).toBeFocused();

    for (let i = 21; i <= 40; i++) await typeBundle(page, `47.${90 + (i % 5)}`, "20");
    await expect(savedRows(page)).toHaveCount(40);
    await expect(page.getByTestId("pack-total-bundles")).toHaveText("40 bundles");

    // Review and save, still keyboard only.
    await tabTo(page, page.getByRole("button", { name: "Review", exact: true }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Review" })).toBeFocused();
    await expect(page.locator("[data-slot='pack-totals']")).toContainText("40");
    await expect(page.getByText("1 bundle is outside the die's range. Check it before saving.")).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Save session" }));
    await page.keyboard.press("Enter");

    await page.waitForURL(SESSION_URL);
    const groupId = new URL(page.url()).pathname.split("/").pop()!;
    expect(groupId).not.toBe("new");
    await expect(page.getByRole("heading", { level: 1, name: /^Session / })).toBeVisible();
    await expect(page.getByTestId("session-cut-length")).toHaveText("11 ft 6 in");
    await expect(page.getByTestId("session-yard")).toHaveText("Y2");
    await expect(page.locator("[data-slot='session-totals']")).toContainText("40");

    const group = await trpcQuery<{
      bundles: { lengthMm: number; quantity: number; locationId: string | null }[];
      group: { unit: string };
    }>(page, "bundle.getGroup", { id: groupId });
    expect(group.bundles).toHaveLength(40);
    expect(new Set(group.bundles.map((b) => b.lengthMm))).toEqual(new Set([3505]));
    expect(group.group.unit).toBe("inch");
    const locations = await trpcQuery<{ items: { id: string; code: string }[] }>(page, "stock.locations.list", {});
    const y2 = locations.items.find((l) => l.code === "Y2")!.id;
    expect(new Set(group.bundles.map((b) => b.locationId))).toEqual(new Set([y2]));

    // The draft is gone after saving.
    const stored = await page.evaluate(() => sessionStorage.getItem("orrn.packDraft"));
    expect(stored).toBeNull();

    // The next session on this device starts on the same yard; Enter in the cut length goes straight on.
    await page.goto("/pack/new");
    await chooseDieAndTypeLength(page);
    await expect(yardTile(page, "Y2")).toBeChecked();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Bundles" })).toBeVisible();
    await expect(page.getByTestId("session-yard")).toHaveText("Y2");
  });

  test("one bundle with a different length and PO; the list shows who packed it", async ({ page }) => {
    await open(page, "/pack/new");
    await chooseDieAndLength(page, "12", "");
    await typeBundle(page, "50.10", "20");

    await page.getByRole("button", { name: "Different length or PO" }).click();
    await page.getByRole("textbox", { name: "Feet" }).last().fill("10");
    await page.getByLabel("PO for this bundle").fill("PO-ODD-7");
    await weightField(page).fill("41.75");
    await piecesField(page).fill("20");
    await page.getByRole("button", { name: "Save bundle" }).click();
    await expect(savedRows(page)).toHaveCount(2);
    await expect(savedRows(page).nth(1)).toContainText("10 ft");
    await expect(savedRows(page).nth(1)).toContainText("PO PO-ODD-7");

    // Edit the first bundle from its row.
    await savedRows(page).nth(0).click();
    await expect(page.getByRole("heading", { name: "Editing bundle 1" })).toBeVisible();
    await expect(weightField(page)).toHaveValue("50.1");
    await piecesField(page).fill("21");
    await page.getByRole("button", { name: "Save bundle" }).click();
    await expect(savedRows(page).nth(0)).toContainText("21");

    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Save session" }).click();
    await page.waitForURL(SESSION_URL);
    const groupId = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.getByTestId("session-cut-length")).toHaveText("Mixed");

    const group = await trpcQuery<{ bundles: { lengthMm: number; poNumber: string | null; quantity: number }[] }>(
      page,
      "bundle.getGroup",
      { id: groupId },
    );
    const byLength = [...group.bundles].sort((a, b) => a.lengthMm - b.lengthMm);
    expect(byLength.map((b) => b.lengthMm)).toEqual([3048, 3658]);
    expect(byLength[0]!.poNumber).toBe("PO-ODD-7");
    expect(byLength[1]!.quantity).toBe(21);

    await page.getByRole("link", { name: "Pack", exact: true }).first().click();
    await expect(page).toHaveURL(/\/pack$/);
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("link") })
      .first();
    await expect(row).toContainText(DIE);
    await expect(row).toContainText(/operator/i);
    await expect(row).toContainText(/Today, \d\d:\d\d/);
  });

  test("a fraction typed in Pieces is refused with its message, never read as a bigger whole number", async ({
    page,
  }) => {
    await open(page, "/pack/new");
    await chooseDieAndLength(page);
    await page.keyboard.type("47.90");
    await page.keyboard.press("Enter");
    await expect(piecesField(page)).toBeFocused();
    // A gloved "20.5" must not become 205 pieces.
    await page.keyboard.type("20.5");
    await expect(piecesField(page)).toHaveValue("20.5");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Enter the pieces as a whole number.")).toBeVisible();
    await expect(piecesField(page)).toBeFocused();
    await expect(savedRows(page)).toHaveCount(0);
  });

  test("Tab through saved bundles on a phone: the focused row is never hidden under the action bar", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await open(page, "/pack/new", { width: 375 });
    await page.setViewportSize({ width: 375, height: 740 });
    const bar = page.locator("[data-slot='pack-bar']:visible");

    // Next without a yard: the error line under the tiles comes into view above the bar, not under it.
    await chooseDieAndTypeLength(page);
    await page.keyboard.press("Enter");
    const yardError = yardGroup(page).getByText("Choose the yard these bundles go to.");
    await expect(yardError).toBeVisible();
    await expect(yardTile(page, "Y1")).toBeFocused();
    await expect
      .poll(async () => {
        const [e, b] = await Promise.all([yardError.boundingBox(), bar.boundingBox()]);
        return e!.y + e!.height <= b!.y + 1;
      }, "yard error above the action bar")
      .toBe(true);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(weightField(page)).toBeFocused();

    for (let i = 1; i <= 12; i++) await typeBundle(page, `47.${90 + (i % 5)}`, "20");
    await expect(savedRows(page)).toHaveCount(12);
    // Row 1 is at the top of the page; Tab walks down the list (WCAG 2.4.11 focus not obscured).
    await savedRows(page).first().focus();
    for (let i = 1; i < 12; i++) {
      await page.keyboard.press("Tab");
      const row = savedRows(page).nth(i);
      await expect(row).toBeFocused();
      const [r, b] = await Promise.all([row.boundingBox(), bar.boundingBox()]);
      expect(r!.y + r!.height, `row ${i + 1} bottom vs action bar top`).toBeLessThanOrEqual(b!.y + 1);
    }
  });

  test("an unsaved session shows on /pack as Not saved and can be continued", async ({ page }) => {
    await open(page, "/pack/new");
    await chooseDieAndLength(page);
    await typeBundle(page, "47.90", "20");
    await expect(savedRows(page)).toHaveCount(1);
    await page.getByRole("link", { name: "Pack", exact: true }).first().click();
    await expect(page.locator("[data-slot='pack-draft']")).toContainText("Not saved");
    await page.getByRole("link", { name: "Continue session", exact: true }).click();
    await expect(savedRows(page)).toHaveCount(1);

    // Discard asks first, then clears.
    await page.getByRole("button", { name: "Discard unsaved bundles" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Source" })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("orrn.packDraft"))).toBeNull();
  });

  test("save and print labels: progress, one failed label with its reason, retry prints only that one", async ({
    page,
  }) => {
    // The seed has no label printing connected: the second label attempt fails as "printer offline".
    const printer = await mockLabelPrinting(page, API, { fail: (n) => n === 2 });

    await open(page, "/pack/new");
    await chooseDieAndLength(page);
    for (const w of ["47.90", "48.10", "47.70"]) await typeBundle(page, w, "20");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Save and print labels" }).click();
    await page.waitForURL(SESSION_URL);

    const panel = page.locator("[data-slot='print-panel']");
    await expect(panel).toHaveAttribute("data-status", "done");
    await expect(panel).toContainText("1 label didn't print");
    await expect(panel).toContainText("2 labels sent to printer");
    await expect(panel).toContainText("The printer didn't take the label. Check it is on and connected.");
    expect(printer.printed).toHaveLength(2);
    expect(await axeSerious(page)).toEqual([]);

    await panel.getByRole("button", { name: "Retry failed labels" }).click();
    await expect(panel).toContainText("1 label sent to printer");
    await expect(panel.getByRole("button", { name: "Retry failed labels" })).toHaveCount(0);
    expect(printer.printed).toHaveLength(3);
    expect(new Set(printer.printed).size).toBe(3);
    expect(printer.attempts()).toBe(4);

    // Reprint one bundle from its row.
    await page
      .getByRole("button", { name: /^Reprint label for / })
      .first()
      .click();
    await expect(panel).toContainText("1 label sent to printer");
    expect(printer.attempts()).toBe(5);
  });

  test("a failed background refresh keeps the list and the session on screen", async ({ page }) => {
    test.setTimeout(120_000);
    /** React Query refetches stale queries when the tab becomes visible again (it listens on window). */
    const refreshOnFocus = () => page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
    /** Fail every request that carries `procedure` (batched or not) and count them. */
    const failFrom = async (procedure: string) => {
      const hits = { n: 0 };
      await page.route(
        (url) => url.pathname.startsWith("/trpc/") && url.pathname.includes(procedure),
        (route) => {
          hits.n++;
          return route.abort();
        },
      );
      return hits;
    };

    await open(page, "/pack");
    const rows = page.locator("[data-slot='responsive-list']").getByRole("row").filter({ has: page.getByRole("link") });
    await expect(rows.first()).toBeVisible();
    const sessionCount = await rows.count();
    const list = await failFrom("bundle.listGroups");
    await refreshOnFocus();
    // The first try plus the client's three retries all fail.
    await expect.poll(() => list.n, { timeout: 45_000 }).toBeGreaterThanOrEqual(4);
    await page.waitForTimeout(500);
    await expect(page.getByText("Packing sessions didn't load. Check the connection and try again.")).toHaveCount(0);
    await expect(rows).toHaveCount(sessionCount);
    await page.unrouteAll({ behavior: "ignoreErrors" });

    await rows.first().getByRole("link").click();
    await page.waitForURL(SESSION_URL);
    await expect(page.locator("[data-slot='session-totals']")).toBeVisible();
    const session = await failFrom("bundle.getGroup");
    await refreshOnFocus();
    await expect.poll(() => session.n, { timeout: 45_000 }).toBeGreaterThanOrEqual(4);
    await page.waitForTimeout(500);
    await expect(page.getByText("This session didn't load. Check the connection and try again.")).toHaveCount(0);
    await expect(page.locator("[data-slot='session-totals']")).toBeVisible();
  });

  test("Enter in Feet moves to Inches, so 11 ft 6 in is never stored as 11 ft", async ({ page }) => {
    await open(page, "/pack/new");
    // Enter right after typing the code, inside the search debounce, still picks the single match.
    await tabTo(page, page.getByLabel("Search die code or section"));
    await page.keyboard.type(DIE);
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Feet", { exact: true })).toBeFocused();
    await page.keyboard.type("11");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Inches", { exact: true })).toBeFocused();
    await expect(page.getByRole("heading", { level: 2, name: "Source" })).toBeVisible();
    await page.keyboard.type("6");
    await page.keyboard.press("Tab");
    await expect(yardTile(page, "Y1")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Bundles" })).toBeVisible();
    await expect(page.getByText("11 ft 6 in").first()).toBeVisible();
  });

  test("a failed save shows its message above the action bar on a phone", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, "/pack/new", { width: 375 });
    await chooseDieAndLength(page);
    for (let i = 0; i < 15; i++) await typeBundle(page, "47.90", "20");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.locator("[data-slot='pack-totals']")).toBeVisible();
    await page.route("**/trpc/bundle.createReceipt*", (route) => route.abort("failed"));
    await page.getByRole("button", { name: "Save session" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "didn't confirm the save" });
    await expect(alert).toBeInViewport({ ratio: 1 });
    const bar = page.locator("[data-slot='pack-bar']");
    const [a, b] = [await alert.boundingBox(), await bar.boundingBox()];
    expect(a && b && a.y + a.height <= b.y + b.height).toBe(true);
    await expect(page.getByRole("link", { name: "Open Pack" })).toBeVisible();
  });

  test("a restored draft in Hindi on a phone keeps its notice readable", async ({ page }) => {
    await open(page, "/pack/new", { width: 375 });
    await chooseDieAndLength(page);
    await typeBundle(page, "47.90", "20");
    await expect(savedRows(page)).toHaveCount(1);
    await page.evaluate(() => localStorage.setItem("orrn.locale", "hi"));
    await page.reload();
    const notice = page.locator("[data-slot='draft-restored']");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    const text = await notice.locator("p").first().boundingBox();
    expect(text?.width ?? 0).toBeGreaterThan(120);
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, "main");
    await page.evaluate(() => localStorage.removeItem("orrn.locale"));
  });

  test("a viewer sees sessions but can't start one", async ({ page }) => {
    await open(page, "/pack", { role: "viewer" });
    await expect(page.getByRole("link", { name: /New packing session/ })).toHaveCount(0);
    await expect(page.locator("[data-slot='responsive-list']")).toBeVisible();
    await page.goto("/pack/new");
    await expect(page.getByText("Your role can't pack bundles. Ask an admin if you need it.")).toBeVisible();
  });

  for (const width of [375, 820, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`layout and a11y at ${width} ${scheme}`, async ({ page }) => {
        test.setTimeout(90_000);
        await open(page, "/pack", { width, scheme });
        await expect(page.locator("[data-slot='responsive-list']")).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main");
        expect(await axeSerious(page)).toEqual([]);

        await page.goto("/pack/new");
        await expect(page.locator("button[data-die]").first()).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main");
        expect(await axeSerious(page)).toEqual([]);

        await chooseDieAndLength(page);
        await typeBundle(page, "47.90", "20");
        await typeBundle(page, "40", "20");
        await page.keyboard.type("47.9");
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main");
        expect(await axeSerious(page)).toEqual([]);

        // A half-typed card blocks Review with its field error (it is never dropped silently), so clear it first.
        await page.getByRole("button", { name: "Review", exact: true }).click();
        await expect(page.getByText("Enter the pieces as a whole number.")).toBeVisible();
        await weightField(page).fill("");
        await page.getByRole("button", { name: "Review", exact: true }).click();
        await expect(page.locator("[data-slot='pack-totals']")).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main");
        expect(await axeSerious(page)).toEqual([]);

        await page.getByRole("button", { name: "Save session" }).click();
        await page.waitForURL(SESSION_URL);
        await expect(page.locator("[data-slot='session-totals']")).toBeVisible();
        await expect(page.locator("[data-slot='responsive-list']")).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main");
        expect(await axeSerious(page)).toEqual([]);
      });
    }
  }
});
