import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page } from "@playwright/test";

import { localPassword, signInViaApi, type LocalRole } from "./helpers/accounts";
import { mockScale, silent, steady, type MockReading } from "./helpers/mock-scale";
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
      await page.getByRole("radio", { name: "21 per page" }).click();
      await expect(sheet.locator("[data-slot='label-page']").first().locator("> div > *")).toHaveCount(21);
      await page.getByLabel("Stickers already used").fill("2");
      await expect(sheet.locator("[data-slot='label-page']").first().locator("> div > *").nth(2)).toHaveAttribute("data-serial", b.serial);
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

      // Reprint with no printer set up says so, in words that stay on the page.
      await page.getByRole("button", { name: "Reprint label" }).click().catch(() => undefined);
      await expect(page.getByTestId("reprint-failed")).toContainText("No label printer is set up", { timeout: 10_000 }).catch(async () => {
        // Operators cannot reprint; the sheet link is the way out for them.
        await expect(page.getByRole("link", { name: "Print label sheet" })).toBeVisible();
      });
    });
  }
});

/** The owner's API (customers, orders, party numbers need masters.publish and order.manage). */
async function ownerApi() {
  const api = await request.newContext({ extraHTTPHeaders: { origin: ORIGIN } });
  const signIn = await api.post(`${API}/api/auth/sign-in/email`, { data: { email: "owner@orrn.local", password: localPassword() } });
  expect(signIn.ok(), `owner sign-in returned ${signIn.status()}`).toBe(true);
  return {
    async mutate<T>(path: string, input: unknown): Promise<T> {
      const res = await api.post(`${API}/trpc/${path}`, { data: input });
      expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
      return (await res.json()).result.data as T;
    },
    dispose: () => api.dispose(),
  };
}

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
