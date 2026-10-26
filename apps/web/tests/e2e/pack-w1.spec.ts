import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { mockScale, silent, steady, type MockReading } from "./helpers/mock-scale";
import { ownSection } from "./helpers/plant-stock";
import { ownerApi } from "./helpers/owner-api";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Pack, Wave 1 (FP-PK-01..07, 14; explorer Highs 12 and 13). The screens show the SERVER's numbers:
 * kg/12 ft, band position and drift come from `bundle.previewLine` / `previewLines`, and the same bundle
 * reads the same on the pack line, the saved session and `/b/$serial`. The scale is mocked in the browser
 * (a node's heartbeat is signed by the node), the rest is the real API.
 *
 * Die 14701 (PATTI) has the band 2.4 to 2.6 kg/12 ft. At 11 ft 6 in (3505 mm), 20 pieces of 47.90 kg
 * give 2.499 (in range, +4.1% over the band start); 40.00 kg gives 2.089 (below).
 */

const API = API_URL;
const ORIGIN = WEB_ORIGIN;
const DIE = "14701";
const WIDTHS = [375, 820, 1280] as const;

test.describe.configure({ timeout: 120_000 });

async function open(page: Page, path: string, opts: { width?: number; role?: LocalRole } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "operator");
  await page.goto(path);
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
}

async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.get(`${API}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function trpcMutation<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API}/trpc/${path}`, { headers: { origin: ORIGIN }, data: input });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

const weight = (p: Page) => p.getByLabel("Weight (kg)", { exact: true });
const pieces = (p: Page) => p.getByLabel("Pieces", { exact: true });
const savedRows = (p: Page) => p.locator("[data-slot='saved-bundle']");
const live = (p: Page) => p.locator("[data-slot='live-k12']");

/** A yard tile by keyboard (the radios are visually hidden; Space on the focused one chooses it). */
async function pickYard(page: Page, code: string) {
  const tile = page.locator(`input[type='radio'][value$='-${code}']`);
  await expect(tile).toBeAttached({ timeout: 15_000 });
  await tile.focus();
  await page.keyboard.press("Space");
  await expect(tile).toBeChecked();
}

/** Step 1: the die, 11 ft 6 in, yard Y2, and (when given) the order; then on to Bundles. */
async function source(page: Page, opts: { orderName?: RegExp } = {}) {
  await page.getByLabel("Search die code or section").fill(DIE);
  await expect(page.locator("button[data-die]")).toHaveCount(1);
  await page.locator("button[data-die]").first().click();
  await page.getByLabel("Feet", { exact: true }).fill("11");
  await page.getByLabel("Inches", { exact: true }).fill("6");
  await pickYard(page, "Y2");
  if (opts.orderName) {
    const orders = page.locator("[data-slot='order-picker']");
    await expect(orders.getByRole("radio", { name: opts.orderName })).toBeAttached({ timeout: 15_000 });
    await orders.getByRole("radio", { name: opts.orderName }).check({ force: true });
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Bundles" })).toBeVisible();
}

async function bundle(page: Page, kgText: string, pcs: string) {
  await weight(page).fill(kgText);
  await pieces(page).fill(pcs);
  await page.getByRole("button", { name: "Save bundle" }).click();
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

async function previewOf(page: Page, kgG: number, pcs: number) {
  const dies = await trpcQuery<{ items: { id: string }[] }>(page, "die.list", { search: DIE, limit: 5 });
  return trpcQuery<{
    kgPer12ftMilli: number;
    position: "in" | "below" | "above" | null;
    driftTone: string;
    driftPercentTenths: number | null;
  }>(page, "bundle.previewLine", { dieId: dies.items[0]!.id, lengthMm: 3505, weightG: kgG, pcs });
}

test.describe("pack: the server's numbers on the pack line", () => {
  for (const width of WIDTHS) {
    test(`live kg/12 ft, band chip and drift chip are the server's, at ${width}`, async ({ page }) => {
      await open(page, "/pack/new", { width });
      await source(page);
      await weight(page).fill("47.90");
      await pieces(page).fill("20");
      const want = await previewOf(page, 47_900, 20);
      expect(want.position).toBe("in");
      await expect(page.getByTestId("live-k12-value")).toHaveText((want.kgPer12ftMilli / 1000).toFixed(3));
      await expect(live(page)).toHaveAttribute("data-tone", "green");
      await expect(live(page)).toContainText("In range");
      // The percent against the band start is the server's tenths, printed with its sign.
      const drift = page.getByTestId("drift-chip");
      await expect(drift).toHaveText(`Drift +${(want.driftPercentTenths! / 10).toFixed(1)}%`);
      await expect(drift).toHaveAttribute("data-drift-tone", want.driftTone);

      // Lighter than the band start: below range, the drift is negative.
      await weight(page).fill("40.00");
      const low = await previewOf(page, 40_000, 20);
      expect(low.position).toBe("below");
      await expect(page.getByTestId("live-k12-value")).toHaveText((low.kgPer12ftMilli / 1000).toFixed(3));
      await expect(live(page)).toHaveAttribute("data-tone", "amber");
      await expect(live(page)).toContainText("Below range");
      await expect(page.getByTestId("drift-chip")).toContainText("-");
      await expectNoHorizontalScroll(page);
    });
  }
});

test.describe("pack: the scale and typed weights", () => {
  test("a steady weight fills the field and says so; a scale weight is refused at save while no node reports a scale", async ({ page }) => {
    let reading: MockReading = { ...steady(0), stable: false, reason: "zero", grams: 0 };
    await mockScale(page, API, () => reading);
    await open(page, "/pack/new", { width: 820 });
    await source(page);
    const strip = page.locator("[data-slot='scale-strip']");
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("scale-chip")).toHaveAttribute("data-scale", "waiting");

    reading = steady(47_900);
    await expect(page.getByTestId("scale-chip")).toHaveAttribute("data-scale", "stable", { timeout: 15_000 });
    await expect(page.getByTestId("scale-chip")).toContainText("47.90");
    await expect(weight(page)).toHaveValue("47.9");
    await expect(strip).toContainText("From the scale");
    // No reason is asked for a weight that came from the scale.
    await expect(page.getByLabel("Why type the weight")).toHaveCount(0);
    await pieces(page).fill("20");
    await page.getByRole("button", { name: "Save bundle" }).click();
    await expect(savedRows(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Save session" }).click();
    // The server asks the node, not the screen: no node reports a scale here, so a "scale" weight is refused in words.
    await expect(page.locator("[data-slot='pack-save-error']")).toContainText("The scale is not connected now. Type the weights and say why.");
  });

  test("with the scale silent a typed weight asks why, saves the reason, and the session saves", async ({ page }) => {
    await mockScale(page, API, () => silent);
    await open(page, "/pack/new", { width: 375 });
    await source(page);
    await expect(page.getByTestId("scale-chip")).toHaveAttribute("data-scale", "silent", { timeout: 15_000 });
    await weight(page).fill("47.90");
    await pieces(page).fill("20");
    const why = page.getByLabel("Why type the weight");
    await expect(why).toBeVisible();
    await page.getByRole("button", { name: "Save bundle" }).click();
    await expect(page.getByText("Say why you typed the weight.")).toBeVisible();
    await expect(savedRows(page)).toHaveCount(0);
    await why.fill("Indicator was off");
    await page.getByRole("button", { name: "Save bundle" }).click();
    await expect(savedRows(page)).toHaveCount(1);
    await expect(savedRows(page).first()).toContainText("Typed");

    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.locator("[data-slot='review-typed']")).toContainText("1 bundle was typed, not weighed");
    await page.getByRole("button", { name: "Save session" }).click();
    await page.waitForURL((url) => /^\/pack\/[^/]+$/.test(url.pathname) && url.pathname !== "/pack/new");
    const groupId = new URL(page.url()).pathname.split("/").pop()!;
    const group = await trpcQuery<{ bundles: { weightSource: string; weightOverrideReason: string | null }[] }>(page, "bundle.getGroup", { id: groupId });
    expect(group.bundles.map((b) => [b.weightSource, b.weightOverrideReason])).toEqual([["manual", "Indicator was off"]]);
  });
});

test.describe("pack: rejects at pack", () => {
  test("a reject row with kg and a reason is saved with the session and posts to plant scrap", async ({ page }) => {
    await open(page, "/pack/new", { width: 820 });
    await source(page);
    await bundle(page, "47.90", "20");
    await expect(savedRows(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Add reject" }).click();
    await page.getByLabel("Reject pieces", { exact: true }).fill("2");
    await page.getByLabel("kg", { exact: true }).last().fill("1.5");
    // "other" would need a note; a plain reason does not.
    await page.getByLabel("Reason", { exact: true }).selectOption("bend");
    await page.getByRole("button", { name: "Save reject" }).click();
    const row = page.locator("[data-slot='reject-row']");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("2 pieces rejected");
    await expect(row).toContainText("1.5 kg");
    await expect(page.getByTestId("reject-total")).toContainText("2 pieces rejected");

    await page.getByRole("button", { name: "Review", exact: true }).click();
    await expect(page.locator("[data-slot='review-rejects']")).toContainText("2 pieces rejected");
    await expect(page.locator("[data-slot='review-rejects']")).toContainText("1.5 kg at plant scrap");
    await page.getByRole("button", { name: "Save session" }).click();
    await page.waitForURL((url) => /^\/pack\/[^/]+$/.test(url.pathname) && url.pathname !== "/pack/new");
    const groupId = new URL(page.url()).pathname.split("/").pop()!;
    const rej = await trpcQuery<{ items: { pcs: number; weightG: number | null; reason: string; groupId: string }[] }>(page, "stock.rejections", { limit: 50 });
    const mine = rej.items.find((r) => r.groupId === groupId);
    expect(mine).toMatchObject({ pcs: 2, weightG: 1500 });
    expect(mine!.reason).toContain("bend");
  });
});

test.describe("pack: reject reasons come from Masters (W4-MASTERS review I-3)", () => {
  test("a code the plant added is offered (with its note rule); a retired one is not", async ({ page }) => {
    const tag = Date.now().toString(36);
    const keptLabel = `E2E die line ${tag}`;
    const goneLabel = `E2E retired ${tag}`;
    await signInViaApi(page, "owner");
    const kept = await trpcMutation<{ id: string; code: string }>(page, "reasonCodes.create", { kind: "qc_reject", label: keptLabel, requiresNote: true });
    const gone = await trpcMutation<{ id: string; code: string }>(page, "reasonCodes.create", { kind: "qc_reject", label: goneLabel });
    await trpcMutation(page, "reasonCodes.setActive", { id: gone.id, active: false });
    try {
      await open(page, "/pack/new", { width: 820 });
      await source(page);
      await bundle(page, "47.90", "20");
      await expect(savedRows(page)).toHaveCount(1);
      await page.getByRole("button", { name: "Add reject" }).click();
      const reason = page.getByLabel("Reason", { exact: true });
      await expect(reason.locator("option", { hasText: keptLabel })).toHaveCount(1);
      await expect(reason.locator("option", { hasText: goneLabel })).toHaveCount(0);
      await expect(reason.locator("option", { hasText: "Bend" })).toHaveCount(1);
      await page.getByLabel("Reject pieces", { exact: true }).fill("1");
      await reason.selectOption(kept.code);
      // The plant set this code to need a note: the note field shows and is asked for.
      await page.getByRole("button", { name: "Save reject" }).click();
      await expect(page.getByText("This reason needs a note.")).toBeVisible();
      await page.getByLabel("Note", { exact: true }).fill("Line on the face");
      await page.getByRole("button", { name: "Save reject" }).click();
      const row = page.locator("[data-slot='reject-row']");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(keptLabel);
    } finally {
      await signInViaApi(page, "owner");
      await trpcMutation(page, "reasonCodes.setActive", { id: kept.id, active: false });
    }
  });
});

test.describe("pack: a booking order is offered last and marked (wave-2 M9)", () => {
  test("a booking line carries 'Booking, not confirmed', sits after confirmed lines and is never Suggested", async ({ page }) => {
    await signInViaApi(page, "owner");
    const section = await ownSection(page, "BKG");
    const name = `Booking E2E ${section.sectionCode}`;
    const owner = await ownerApi();
    const orderIds: string[] = [];
    try {
      // Both states belong to this test's section; no other spec can close or pack away its confirmed line.
      for (const booking of [false, true]) {
        const customer = await owner.mutate<{ id: string }>("customer.create", { name: booking ? name : `Confirmed ${section.sectionCode}` });
        const order = await owner.mutate<{ id: string }>("orders.create", {
          customerId: customer.id,
          poNumber: `${section.sectionCode}-${booking ? "booking" : "confirmed"}`,
          lines: [{ sectionId: section.dieId, dieInstanceId: section.dieInstanceId, cutLengthMm: 3505, qtyBasis: "kg", kgG: 500_000, alloy: "6063", temper: "T6" }],
        });
        orderIds.push(order.id);
        if (!booking) {
          const got = await owner.query<{ order: { serverSeq: number } }>("orders.get", { id: order.id });
          await owner.mutate("orders.confirm", { id: order.id, serverSeq: got.order.serverSeq });
        }
      }
      await open(page, "/pack/new", { width: 820 });
      await page.getByLabel("Search die code or section").fill(section.sectionCode);
      await page.locator("button[data-die]").filter({ hasText: section.sectionCode }).click();
      const orders = page.locator("[data-slot='order-picker']");
      const orderChoices = orders.locator("label").filter({ hasText: section.sectionCode });
      const ours = orderChoices.filter({ hasText: name });
      await expect(orderChoices).toHaveCount(2);
      await expect(ours).toBeVisible({ timeout: 15_000 });
      await expect(ours).toContainText("Booking, not confirmed");
      await expect(ours).not.toContainText("Suggested");
      const marks = await orderChoices.evaluateAll((els) => els.map((el) => (el.textContent ?? "").includes("Booking, not confirmed")));
      const firstBooking = marks.indexOf(true);
      expect(firstBooking).toBeGreaterThan(0);
      expect(marks.slice(firstBooking).every(Boolean)).toBe(true);
      const suggested = orderChoices.filter({ hasText: "Suggested" });
      if ((await suggested.count()) > 0) await expect(suggested.first()).not.toContainText("Booking, not confirmed");
    } finally {
      try {
        for (const id of orderIds) {
          const got = await owner.query<{ order: { status: string; serverSeq: number } }>("orders.get", { id });
          if (got.order.status === "booking") await owner.mutate("orders.confirm", { id, serverSeq: got.order.serverSeq });
          await owner.mutate("orders.close", { id, reason: "e2e cleanup" });
        }
        await owner.mutate("dieInstance.update", { id: section.dieInstanceId, status: "retired" });
        await owner.mutate("die.update", { id: section.dieId, series: "PATTI", sectionCode: section.sectionCode, weightMinG: 2400, weightMaxG: 2600, status: "archived" });
      } finally {
        await owner.dispose();
      }
    }
  });
});

test.describe("pack: party number after save, one tone everywhere, labels with no printer", () => {
  for (const width of WIDTHS) {
    test(`a customer's own number shows after save; the pack line, the session and /b agree; the label sheet works, at ${width}`, async ({ page }) => {
      await open(page, "/pack/new", { width });
      // A customer of its own with lifelong party numbers, and an open order for the die.
      const name = `Party E2E ${width} ${Date.now() % 100_000}`;
      const owner = await ownerApi();
      const created = await owner.mutate<{ id: string }>("customer.create", { name });
      await owner.mutate("customer.update", { id: created.id, name, bundleNumberPolicy: "lifelong" });
      const dies = await trpcQuery<{ items: { id: string }[] }>(page, "die.list", { search: DIE, limit: 5 });
      await owner.mutate("orders.create", { customerId: created.id, poNumber: null, lines: [{ sectionId: dies.items[0]!.id, cutLengthMm: 3505, kgG: 500_000, pcs: null, finish: null }] });
      await owner.dispose();

      await page.reload();
      await expect(page.locator("main#main h1").first()).toBeVisible();
      await source(page, { orderName: new RegExp(name) });
      await weight(page).fill("47.90");
      await pieces(page).fill("20");
      await expect(live(page)).toContainText("In range");
      await page.getByRole("button", { name: "Save bundle" }).click();
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await expect(page.getByText(name.slice(0, 12), { exact: false }).first()).toBeVisible();
      await page.getByRole("button", { name: "Save session" }).click();
      // The toast names the party number at once.
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: /Party number/ })).toBeVisible();
      await page.waitForURL((url) => /^\/pack\/[^/]+$/.test(url.pathname) && url.pathname !== "/pack/new");
      const groupId = new URL(page.url()).pathname.split("/").pop()!;
      const group = await trpcQuery<{ bundles: { serial: string; partyNo: string | null; band: { position: string } }[] }>(page, "bundle.getGroup", { id: groupId });
      const b = group.bundles[0]!;
      expect(b.partyNo).toBeTruthy();
      expect(b.partyNo).not.toBe(b.serial);

      // The session page shows the party number column and the server's band chip.
      await expect(page.getByRole("columnheader", { name: "Party no." }).or(page.getByText("Party no.").first())).toBeVisible();
      await expect(page.getByRole("main").getByText(b.partyNo!, { exact: true }).first()).toBeVisible();
      const sessionChip = page.locator("[data-slot='responsive-list'] [data-verdict]").first();
      await expect(sessionChip).toHaveAttribute("data-verdict", "in");

      // No label printer here: the page says so and offers the A4 sticker sheet.
      const fallback = page.locator("[data-slot='label-fallback']");
      await expect(fallback).toContainText("No label printer is connected");
      await fallback.getByRole("link", { name: "Print label sheet" }).click();
      await expect(page).toHaveURL(new RegExp(`/pack/${groupId}/labels`));
      const sheet = page.getByTestId("label-sheet");
      await expect(sheet).toBeVisible();
      const sticker = sheet.locator(`[data-slot='sticker'][data-serial='${b.serial}']`);
      await expect(sticker).toBeVisible();
      await expect(sticker.locator("img[src^='data:image/png']")).toHaveCount(1, { timeout: 15_000 });
      await expect(sticker).toContainText(b.partyNo!);
      await expect(sticker).toContainText("47.90");
      // 10 up by default, 21 up on request, and a part-used sheet starts later.
      await expect(sheet.locator("[data-slot='label-page']").first().locator("> div > *")).toHaveCount(10);
      // C-1: the QR sits in its own column; it never covers the company name, the serial or the weight,
      // on screen and as printed, and the printed QR reads back as this bundle's /b link.
      await expectStickerFits(sticker);
      await page.emulateMedia({ media: "print", colorScheme: "light", reducedMotion: "reduce" });
      await expectStickerFits(sticker);
      expect(await decodeStickerQr(sticker)).toBe(b.serial);
      await page.emulateMedia({ media: "screen", colorScheme: "light", reducedMotion: "reduce" });
      await page.getByRole("radio", { name: "21 per page" }).click();
      await expect(sheet.locator("[data-slot='label-page']").first().locator("> div > *")).toHaveCount(21);
      await expectStickerFits(sticker);
      await page.emulateMedia({ media: "print", colorScheme: "light", reducedMotion: "reduce" });
      await expectStickerFits(sticker);
      await page.emulateMedia({ media: "screen", colorScheme: "light", reducedMotion: "reduce" });
      await page.getByLabel("Stickers already used").fill("2");
      await expect(sheet.locator("[data-slot='label-page']").first().locator("> div > *").nth(2)).toHaveAttribute("data-serial", b.serial);
      // Back from print media: let the 0.01 ms reduced-motion transitions finish before measuring the page.
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);

      // /b says the same: the same band position the pack line and the session showed, and where it is.
      await page.goto(`/b/${b.serial}`);
      const facts = page.getByTestId("bundle-facts");
      await expect(facts.getByTestId("band-chip")).toHaveAttribute("data-verdict", "in");
      await expect(facts.getByTestId("drift-chip")).toBeVisible();
      await expect(facts.locator("[data-fact='location'] dd")).toHaveText("Y2");
      await expect(facts.locator("[data-fact='party'] dd")).toHaveText(b.partyNo!);
      await expect(facts.locator("[data-fact='order'] dd")).toContainText(name);
      const detail = await trpcQuery<{ band: { position: string; tone: string } }>(page, "bundle.getBySerial", { serial: b.serial });
      expect(detail.band.position).toBe(b.band.position);
      await expect(facts.getByTestId("drift-chip")).toHaveAttribute("data-drift-tone", detail.band.tone);
      // History shows who did it.
      await expect(page.getByTestId("bundle-timeline").locator("[data-slot='actor']").first()).toContainText("by ");

      // Reprint with no printer set up says so, in words that stay on the page, with the sheet as the way out.
      // (The operator holds spool.create_jobs, so the button is there.)
      await page.getByRole("button", { name: "Reprint label" }).click();
      const failed = page.getByTestId("reprint-failed");
      await expect(failed).toContainText("No label printer is set up", { timeout: 10_000 });
      await expect(failed.getByRole("link", { name: "Print label sheet" })).toBeVisible();
    });
  }
});

type Box = { x: number; y: number; width: number; height: number };
/** Sub-pixel layout noise (fractional widths at 375/820 under load, font swap rounding): 1 px either way is the same layout. */
const TOL = 1;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - TOL && b.x < a.x + a.width - TOL && a.y < b.y + b.height - TOL && b.y < a.y + a.height - TOL;
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - TOL && inner.y >= outer.y - TOL && inner.x + inner.width <= outer.x + outer.width + TOL && inner.y + inner.height <= outer.y + outer.height + TOL;

/**
 * C-1: the QR box never intersects the company name, serial or weight, and all of them sit inside the sticker.
 * Every box is read in one pass in the page, so a reflow above the sheet between reads cannot skew them.
 */
async function expectStickerFits(sticker: ReturnType<Page["locator"]>) {
  await expect(sticker.locator("img[data-slot='sticker-qr']")).toBeVisible({ timeout: 15_000 });
  // Under reduced motion every property change is a 0.01 ms transition (globals.css), so a box read in
  // the same frame as a density or media switch still has its old size: wait two frames first.
  // Fonts first (a late web font changes the text widths), then wait until the boxes stop moving: two frames
  // are not enough when the machine is loaded (a density switch is a 0.01 ms transition per property, and
  // one measured mid-flight showed the 21-up grid with the 10-up QR). Stable = the same boxes on three
  // frames in a row; the last read is what is judged.
  const boxes = await sticker.evaluate(async (el) => {
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const nodes = [el, ...Array.from(el.querySelectorAll("[data-slot^='sticker-']"))];
    await Promise.all(nodes.map((n) => document.fonts.load(getComputedStyle(n).font, n.textContent ?? "").catch(() => [])));
    await document.fonts.ready;
    const box = (e: Element | null) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const slot = (name: string) => box(el.querySelector(`[data-slot='${name}']`));
    const read = () => {
      const weight = el.querySelector("[data-slot='sticker-weight']");
      return {
        outer: box(el)!,
        qr: slot("sticker-qr"),
        parts: { "sticker-company": slot("sticker-company"), "sticker-serial": slot("sticker-serial"), "sticker-weight": slot("sticker-weight") },
        weightClipped: weight ? weight.scrollWidth > weight.clientWidth + 1 : true,
      };
    };
    let last = JSON.stringify(read());
    let same = 0;
    for (let i = 0; i < 100 && same < 3; i += 1) {
      await frame();
      const now = JSON.stringify(read());
      same = now === last ? same + 1 : 0;
      last = now;
    }
    return JSON.parse(last) as ReturnType<typeof read>;
  });
  const qr = boxes.qr;
  expect(qr, "sticker-qr has a box").not.toBeNull();
  expect(qr!.width).toBeGreaterThan(20);
  expect(inside(qr!, boxes.outer), `QR inside the sticker ${JSON.stringify(boxes)}`).toBe(true);
  for (const [slot, b] of Object.entries(boxes.parts)) {
    expect(b, `${slot} has a box`).not.toBeNull();
    expect(overlaps(qr!, b!), `QR covers ${slot}`).toBe(false);
    expect(inside(b!, boxes.outer), `${slot} inside the sticker ${JSON.stringify(boxes)}`).toBe(true);
  }
  // The weight is not clipped by the text column either.
  expect(boxes.weightClipped).toBe(false);
}

/** Decode the sticker's QR as rendered and return the bundle number its /b link names. */
async function decodeStickerQr(sticker: ReturnType<Page["locator"]>): Promise<string> {
  // The exact PNG the sticker prints (a phone-width screenshot of a 55 px QR reads only some of the time).
  const src = (await sticker.locator("img[data-slot='sticker-qr']").getAttribute("src")) ?? "";
  expect(src).toMatch(/^data:image\/png;base64,/);
  const png = Buffer.from(src.slice(src.indexOf(",") + 1), "base64");
  const { readBarcodes } = await import("zxing-wasm/reader");
  const found = await readBarcodes(new Uint8Array(png), { formats: ["QRCode"], tryHarder: true });
  expect(found.length, "the printed QR reads").toBeGreaterThan(0);
  const url = new URL(found[0]!.text);
  const m = /^\/b\/([^/]+)$/.exec(url.pathname);
  expect(m, `QR is a /b link: ${found[0]!.text}`).not.toBeNull();
  return decodeURIComponent(m![1]!);
}

test.describe("pack: a save whose reply is lost is sent again safely (BACKLOG 50)", () => {
  test("the first save lands but its reply is cut; Save again replays it: one bundle set, the same serials", async ({ page }) => {
    await open(page, "/pack/new", { width: 820 });
    await source(page);
    await bundle(page, "47.90", "20");
    await bundle(page, "48.10", "20");
    await expect(savedRows(page)).toHaveCount(2);
    await page.getByRole("button", { name: "Review", exact: true }).click();

    // The first request reaches orrn and packs; the browser never hears back (yard Wi-Fi drops).
    const sent: { key: string; body: string }[] = [];
    let cut = true;
    await page.route("**/trpc/bundle.createReceipt*", async (route) => {
      const posted = route.request().postData() ?? "";
      const response = await route.fetch();
      sent.push({ key: /"clientRequestId":"([^"]+)"/.exec(posted)?.[1] ?? "", body: await response.text() });
      if (cut) {
        cut = false;
        await route.abort("connectionreset");
        return;
      }
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Save session" }).click();
    await expect(page.locator("[data-slot='pack-save-error']")).toContainText("Tap Save again", { timeout: 15_000 });
    await page.getByRole("button", { name: "Save session" }).click();
    await page.waitForURL((url) => /^\/pack\/[^/]+$/.test(url.pathname) && url.pathname !== "/pack/new", { timeout: 20_000 });
    await page.unroute("**/trpc/bundle.createReceipt*");

    expect(sent).toHaveLength(2);
    expect(sent[0]!.key).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(sent[1]!.key).toBe(sent[0]!.key);
    const groupOf = (body: string) => /"groupId":"([^"]+)"/.exec(body)?.[1];
    expect(sent[0]!.body).toContain('"replayed":false');
    expect(sent[1]!.body).toContain('"replayed":true');
    expect(groupOf(sent[1]!.body)).toBe(groupOf(sent[0]!.body));
    // One bundle set: the session page is the first save's group, with its two bundles and no others.
    const groupId = new URL(page.url()).pathname.split("/").pop()!;
    expect(groupId).toBe(groupOf(sent[0]!.body));
    const group = await trpcQuery<{ bundles: { serial: string }[] }>(page, "bundle.getGroup", { id: groupId });
    expect(group.bundles).toHaveLength(2);
    const serials = group.bundles.map((b) => b.serial);
    for (const serial of serials) {
      const hits = await trpcQuery<{ items: { serial: string }[] }>(page, "bundle.listBundles", { search: serial, limit: 5 });
      expect(hits.items.filter((h) => h.serial === serial)).toHaveLength(1);
    }
  });
});

test.describe("pack: the one source that applies comes pre-picked (BACKLOG 99)", () => {
  test("a single open order line and the copy on the press are chosen for the packer; a copy out for nitriding is still offered with its status (Q63 A)", async ({ page }) => {
    const names = (url: string) => decodeURIComponent(new URL(url).pathname.split("/trpc/")[1] ?? "").split(",");
    await page.route("**/trpc/**", async (route) => {
      const procs = names(route.request().url());
      const iLines = procs.indexOf("orders.openLines");
      const iCopies = procs.indexOf("dieInstance.list");
      if (iLines === -1 && iCopies === -1) return route.fallback();
      const response = await route.fetch();
      const body = await response.json();
      const entryAt = (i: number) => (Array.isArray(body) ? body[i] : body)?.result?.data as { json?: unknown } | undefined;
      const lines = iLines === -1 ? undefined : entryAt(iLines);
      if (lines) {
        const list = (lines.json ?? lines) as unknown[];
        list.splice(1);
      }
      const copies = iCopies === -1 ? undefined : entryAt(iCopies);
      if (copies) {
        const data = (copies.json ?? copies) as { items: Record<string, unknown>[] };
        const first = data.items[0]!;
        data.items = [
          { ...first, id: `${String(first.id)}`, code: "RUN-1", status: "in_use", pinnedCopyId: null },
          { ...first, id: `${String(first.id)}-n`, code: "NIT-9", status: "at_nitriding" },
          { ...first, id: `${String(first.id)}-a`, code: "AVL-9", status: "available" },
        ];
      }
      await route.fulfill({ response, json: body });
    });
    await open(page, "/pack/new", { width: 375 });
    await page.getByLabel("Search die code or section").fill(DIE);
    await expect(page.locator("button[data-die]")).toHaveCount(1);
    await page.locator("button[data-die]").first().click();
    const orders = page.locator("[data-slot='order-picker']");
    await expect(orders.getByRole("radio", { checked: true })).toHaveCount(1, { timeout: 15_000 });
    await expect(orders.getByRole("radio", { name: /plant stock/i })).not.toBeChecked();
    const copies = page.locator("[data-slot='copy-picker']");
    await expect(copies.getByRole("radio", { name: "RUN-1" })).toBeChecked({ timeout: 15_000 });
    await expect(copies.getByRole("radio", { name: "NIT-9" })).not.toBeChecked();
    await expect(copies.getByRole("radio", { name: "NIT-9" })).toHaveCount(1);
    await expect(copies.getByText("At nitriding").first()).toBeVisible();
    await expect(copies.getByRole("radio", { name: "AVL-9" })).not.toBeChecked();
  });
});

test.describe("pack: an order line that pins a die copy (D15)", () => {
  test("the screen preselects the pinned copy and locks the others; the pack line is judged on that copy's band; the server refuses another copy", async ({ page }) => {
    const owner = await ownerApi();
    const name = `Pin E2E ${Date.now() % 100_000}`;
    const created = await owner.mutate<{ id: string }>("customer.create", { name });
    const tee = await owner.query<{ items: { id: string }[] }>("die.list", { search: "13090", limit: 5 });
    const sectionId = tee.items[0]!.id;
    const copies = await owner.query<{ items: { id: string; code: string }[] }>("dieInstance.list", { sectionId, limit: 50, offset: 0 });
    const pin = copies.items.find((c) => c.code === "13090-3")!;
    const other = copies.items.find((c) => c.code === "13090-1")!;
    await owner.mutate("orders.create", {
      customerId: created.id,
      poNumber: null,
      lines: [{ sectionId, cutLengthMm: 3505, kgG: 500_000, pcs: null, finish: null, dieInstanceId: pin.id }],
    });
    // A weight the pinned copy's band and the section's own band judge differently.
    const kgG = 59_410;
    const onPin = await owner.query<{ position: string | null }>("bundle.previewLine", { dieId: sectionId, dieInstanceId: pin.id, lengthMm: 3505, weightG: kgG, pcs: 20 });
    const onSection = await owner.query<{ position: string | null }>("bundle.previewLine", { dieId: sectionId, lengthMm: 3505, weightG: kgG, pcs: 20 });
    expect(onPin.position).not.toBe(onSection.position);

    await open(page, "/pack/new", { width: 820 });
    await page.getByLabel("Search die code or section").fill("13090");
    await expect(page.locator("button[data-die]")).toHaveCount(1);
    await page.locator("button[data-die]").first().click();
    const orders = page.locator("[data-slot='order-picker']");
    await expect(orders.getByRole("radio", { name: new RegExp(name) })).toBeAttached({ timeout: 15_000 });
    await orders.getByRole("radio", { name: new RegExp(name) }).check({ force: true });
    const copiesPicker = page.locator("[data-slot='copy-picker']");
    await expect(copiesPicker.getByRole("radio", { name: "13090-3", exact: true })).toBeChecked();
    await expect(copiesPicker.getByRole("radio", { name: "13090-1", exact: true })).toBeDisabled();
    await expect(copiesPicker).toContainText("This line is for die copy 13090-3.");
    // The operator holds no order.manage: no override.
    await expect(page.locator("[data-slot='pin-override']")).toHaveCount(0);

    await page.getByLabel("Feet", { exact: true }).fill("11");
    await page.getByLabel("Inches", { exact: true }).fill("6");
    await pickYard(page, "Y2");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Bundles" })).toBeVisible();
    await weight(page).fill("59.41");
    await pieces(page).fill("20");
    // The pack line's chip is the copy's band verdict (the same helper the saved bundle and /b use).
    await expect(live(page)).toHaveAttribute("data-verdict", onPin.position ?? "none", { timeout: 15_000 });

    // The server refuses another copy for this line, in words.
    const lines = await owner.query<{ lineId: string; customerId: string; pinnedCopyId: string | null }[]>("orders.openLines", { dieId: sectionId });
    const line = lines.find((l) => l.customerId === created.id)!;
    expect(line.pinnedCopyId).toBe(pin.id);
    const yards = await owner.query<{ items: { id: string; code: string }[] }>("stock.locations.list", {});
    const yardId = yards.items.find((y) => y.code === "Y2")!.id;
    const refused = await page.context().request.post(`${API}/trpc/bundle.createReceipt`, {
      headers: { origin: ORIGIN },
      data: { dieId: sectionId, unit: "inch", locationId: yardId, source: "order", salesOrderLineId: line.lineId, dieInstanceId: other.id, rows: [{ quantity: 20, weightG: kgG, lengthMm: 3505 }] },
    });
    expect(refused.status()).toBe(400);
    expect(await refused.text()).toContain("This line is pinned to 13090-3");
    await owner.dispose();

    // The office (order.manage) sees the override; turning it on frees the other copies.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await open(page, "/pack/new", { width: 820, role: "owner" });
    await page.getByLabel("Search die code or section").fill("13090");
    await expect(page.locator("button[data-die]")).toHaveCount(1);
    await page.locator("button[data-die]").first().click();
    await expect(orders.getByRole("radio", { name: new RegExp(name) })).toBeAttached({ timeout: 15_000 });
    await orders.getByRole("radio", { name: new RegExp(name) }).check({ force: true });
    await expect(copiesPicker.getByRole("radio", { name: "13090-1", exact: true })).toBeDisabled();
    await page.locator("[data-slot='pin-override'] input").check();
    await expect(copiesPicker.getByRole("radio", { name: "13090-1", exact: true })).toBeEnabled();
  });
});

test.describe("pack: Hindi and Gujarati at 375, readable, no sideways scroll, axe clean", () => {
  for (const locale of ["hi", "gu"] as const) {
    test(`Source, Bundles and Review in ${locale}`, async ({ page }) => {
      await open(page, "/pack", { width: 375 });
      await page.evaluate((l) => localStorage.setItem("orrn.locale", l), locale);
      await page.goto("/pack/new");
      await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
      // Step 1 (Source): its own words, not English keys.
      const heading = page.getByRole("heading", { level: 2 }).first();
      await expect(heading).toHaveText(locale === "hi" ? "स्रोत" : "સ્રોત");
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);

      await page.locator("input[type='search']").first().fill(DIE);
      await expect(page.locator("button[data-die]")).toHaveCount(1);
      await page.locator("button[data-die]").first().click();
      await expect(page.locator("[data-slot='source-extras']")).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main");
      expect(await axeSerious(page)).toEqual([]);

      await page.locator("input[inputmode='decimal']").first().fill("11");
      await page.locator("input[inputmode='decimal']").nth(1).fill("6");
      await pickYard(page, "Y2");
      await page.locator("form button[type='submit']").first().click();
      await expect(page.locator("[data-slot='bundle-card']")).toBeVisible({ timeout: 15_000 });
      await page.locator("input[inputmode='decimal']").first().fill("47.90");
      await page.locator("input[inputmode='decimal']").nth(1).fill("20");
      await expect(page.getByTestId("live-k12-value")).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main");
      expect(await axeSerious(page)).toEqual([]);
      await page.evaluate(() => localStorage.removeItem("orrn.locale"));
    });
  }
});
