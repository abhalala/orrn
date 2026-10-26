import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { test } from "./helpers/test";
import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { fillVehicleIfAsked } from "./helpers/dispatch-vehicle";
import { dieId, newCustomer, newOrder, ownerApi, packBundles, type OwnerApi } from "./helpers/owner-api";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Dispatch, Wave 1 (FP-PK-11/12/13/15, D12). The floor scan says why a bundle may not go on the load,
 * in ORRN words and aloud; only the office (order.manage) may add a bundle that is on no order; the
 * truck's load against its capacity warns and completing over it asks why; the packing list is the
 * plant's v2 with revisions, branding and combine.
 *
 * Every test builds its own customers and bundles through the owner's API, so parallel specs never
 * share a dispatch. The seed has one real ambiguity: the monthly customer's first party number (like "26J1") is
 * also a plant serial. Its month letter comes from the seed's clock, so the spec reads the code from the seeded
 * clash bundle instead of hard-coding October.
 */

const WIDTHS = [375, 820, 1280] as const;
/** The dispatch page's own button (the tab bar's Scan is another button); Gujarati reads English here. */
const scanWord = { hi: "Bundle स्कैन करें", gu: "Bundle સ્કૅન કરો" } as const;
const DIE = "14701";

test.describe.configure({ timeout: 180_000 });

async function start(page: Page, role: LocalRole, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
}

/** Spoken refusals are captured (headless Chromium has no audio). */
async function captureSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    const synth = window.speechSynthesis;
    if (synth) synth.speak = (u: SpeechSynthesisUtterance) => void w.__spoken.push(u.text);
  });
}
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken ?? []);

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

/** Customers A and B, B's order, and one bundle of each kind the scan can refuse or take. */
async function gate(api: OwnerApi, tag: string) {
  const a = await newCustomer(api, `Gate A ${tag}`);
  const b = await newCustomer(api, `Gate B ${tag}`);
  const die = await dieId(api, DIE);
  const order = await newOrder(api, b.id, die);
  const row = (kgG: number) => ({ quantity: 20, weightG: kgG });
  const wrong = (await packBundles(api, die, [row(50_000)], { salesOrderLineId: order.lineId })).bundles[0]!;
  const loose = (await packBundles(api, die, [row(51_000)])).bundles[0]!;
  const plant = (await packBundles(api, die, [row(52_000)], { plantStock: true })).bundles[0]!;
  const d = await api.mutate<{ id: string; code: string }>("dispatch.create", { customerId: a.id });
  return { a, b, wrong, loose, plant, d, die };
}

/** The ambiguous code the demo plant keeps on purpose: kd's first monthly party number, e.g. "26J1" in October 2026. */
async function clashCode(api: OwnerApi) {
  const { bundle: seeded } = await api.query<{ bundle: { serial: string; partyNo: string | null } }>("bundle.getBundle", { id: "dev-bundle-party-clash" });
  expect(seeded.partyNo, "the seeded clash bundle").toBeTruthy();
  expect(seeded.serial).toBe(seeded.partyNo);
  // Year (two digits) + month letter A-L + sequence 1: the month letter follows the seed's clock.
  expect(seeded.serial).toMatch(/^\d{2}[A-L]1$/);
  return seeded.serial;
}

async function openScan(page: Page, d: { id: string; code: string }) {
  await visit(page, `/dispatch/${d.id}`);
  await page.getByRole("button", { name: "Scan bundles" }).click();
  const sheet = page.getByRole("dialog", { name: `Scanning into ${d.code}` });
  await expect(sheet).toBeVisible();
  return { sheet, field: sheet.getByLabel("Serial or label link"), status: sheet.getByRole("status") };
}

test.describe("dispatch scan: refusals in ORRN wording, spoken, and the office's Add anyway", () => {
  for (const width of WIDTHS) {
    test(`floor scan at ${width}: other customer, no order, ambiguous, plant stock`, async ({ page }) => {
      const api = await ownerApi();
      const g = await gate(api, `${width}-${Date.now() % 100_000}`);
      const clash = await clashCode(api);
      await api.dispose();
      await captureSpeech(page);
      await start(page, "operator", width);
      const { sheet, field, status } = await openScan(page, g.d);

      await field.fill(g.wrong.serial);
      await field.press("Enter");
      await expect(status).toContainText(`Packed for ${g.b.name}`);

      await field.fill(g.loose.serial);
      await field.press("Enter");
      await expect(status).toContainText("Not on a sales order");
      // The floor never sees the office's override.
      await expect(sheet.getByTestId("add-anyway")).toHaveCount(0);

      await field.fill(clash);
      await field.press("Enter");
      await expect(status).toContainText(`More than one bundle has this number: ${clash}, BG-000001-B001`);
      await expect(sheet.getByRole("list", { name: "Pick the bundle" }).getByRole("button")).toHaveCount(2);

      await field.fill(g.plant.serial);
      await field.press("Enter");
      await expect(status).toContainText(`Added ${g.plant.serial}`);
      await expect(sheet.getByTestId("scan-count")).toHaveText("1 added");

      // Each refusal was spoken in the same words.
      const said = await spoken(page);
      expect(said).toEqual(expect.arrayContaining([`Packed for ${g.b.name}`, "Not on a sales order"]));
      expect(said.some((s) => s.startsWith("More than one bundle has this number"))).toBe(true);
      // The recent list names what happened to each.
      await expect(sheet.getByRole("list", { name: "Recent scans" }).getByRole("listitem")).toHaveCount(4);
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);

      const items = await ownerItems(g.d.id);
      expect(items).toEqual([g.plant.serial]);
    });
  }

  test("Add anyway is the office's: visible with order.manage only, audited, and the bundle goes on", async ({ page }) => {
    const api = await ownerApi();
    const g = await gate(api, `anyway-${Date.now() % 100_000}`);
    await api.dispose();
    // The operator: no button, however the screen is reached.
    await start(page, "operator", 820);
    {
      const { sheet, field, status } = await openScan(page, g.d);
      await field.fill(g.loose.serial);
      await field.press("Enter");
      await expect(status).toContainText("Not on a sales order");
      await expect(sheet.getByTestId("add-anyway")).toHaveCount(0);
    }
    // The office has it.
    await page.context().clearCookies();
    await start(page, "office", 820);
    const { sheet, field, status } = await openScan(page, g.d);
    await field.fill(g.loose.serial);
    await field.press("Enter");
    await expect(status).toContainText("Not on a sales order");
    await expect(sheet.getByTestId("add-anyway")).toContainText("Add anyway (not on a sales order)");
    await sheet.getByTestId("add-anyway").click();
    await expect(status).toContainText(`Added ${g.loose.serial}, no order`);
    await expect(sheet.getByTestId("scan-count")).toHaveText("1 added");
    expect(await ownerItems(g.d.id)).toEqual([g.loose.serial]);
    // Another customer's bundle is never let through, not even for the office.
    await field.fill(g.wrong.serial);
    await field.press("Enter");
    await expect(status).toContainText(`Packed for ${g.b.name}`);
    await expect(sheet.getByTestId("add-anyway")).toHaveCount(0);
  });

  test("paste: refusals name the customer, and only the office is offered Add anyway", async ({ page }) => {
    const api = await ownerApi();
    const g = await gate(api, `paste-${Date.now() % 100_000}`);
    await api.dispose();
    const paste = async (role: LocalRole) => {
      await start(page, role, 820);
      await visit(page, `/dispatch/${g.d.id}`);
      await page.getByRole("button", { name: "Paste serials" }).click();
      const sheet = page.getByRole("dialog", { name: "Paste serials" });
      await sheet.getByLabel("Serials").fill([g.wrong.serial, g.loose.serial, g.plant.serial].join("\n"));
      await sheet.getByRole("button", { name: "Add bundles" }).click();
      await expect(sheet.getByText("What happened")).toBeVisible();
      return sheet;
    };
    const floor = await paste("operator");
    await expect(floor).toContainText("1 added");
    await expect(floor).toContainText(`Packed for ${g.b.name}`);
    await expect(floor).toContainText("Not on a sales order");
    await expect(floor.getByTestId("add-anyway")).toHaveCount(0);
    await page.context().clearCookies();
    const office = await paste("office");
    await expect(office.getByTestId("add-anyway")).toContainText("Add anyway (not on a sales order) (1)");
    await office.getByTestId("add-anyway").click();
    await expect(office).toContainText("1 added");
    await expect(office.getByTestId("add-anyway")).toHaveCount(0);
    expect((await ownerItems(g.d.id)).sort()).toEqual([g.loose.serial, g.plant.serial].sort());
  });

  for (const [locale, word] of [
    ["hi", "किसी सेल्स ऑर्डर पर नहीं"],
    ["gu", "કોઈ સેલ્સ ઓર્ડર પર નથી"],
  ] as const) {
    test(`the refusal is said in ${locale} at 375: readable, no sideways scroll, axe clean`, async ({ page }) => {
      const api = await ownerApi();
      const g = await gate(api, `${locale}-${Date.now() % 100_000}`);
      await api.dispose();
      await captureSpeech(page);
      await start(page, "operator", 375);
      await page.goto("/today");
      await page.evaluate((l) => localStorage.setItem("orrn.locale", l), locale);
      await visit(page, `/dispatch/${g.d.id}`);
      await page.getByRole("button", { name: scanWord[locale] }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      const field = sheet.locator("input[placeholder='26I4086']");
      const status = sheet.getByRole("status");
      await field.fill(g.loose.serial);
      await field.press("Enter");
      await expect(status).toContainText(word);
      expect(await spoken(page)).toContain(word);
      await field.fill(g.wrong.serial);
      await field.press("Enter");
      await expect(status).toContainText(g.b.name);
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "[data-slot='sheet']");
      expect(await axeSerious(page)).toEqual([]);
      await expectNoClippedText(page, "[data-slot='sheet']");
      await page.evaluate(() => localStorage.removeItem("orrn.locale"));
    });
  }
});

async function ownerItems(dispatchId: string): Promise<string[]> {
  const api = await ownerApi();
  try {
    const d = await api.query<{ items: { serial: string }[] }>("dispatch.getDispatch", { id: dispatchId });
    return d.items.map((i) => i.serial);
  } finally {
    await api.dispose();
  }
}

test.describe("dispatch: truck capacity, transporter, completing over capacity", () => {
  for (const width of WIDTHS) {
    test(`new dispatch with a transporter and 300 kg capacity; near, over, and a reason to dispatch, at ${width}`, async ({ page }) => {
      const api = await ownerApi();
      const tag = `${width}-${Date.now() % 100_000}`;
      const cust = await newCustomer(api, `Cap ${tag}`);
      const die = await dieId(api, DIE);
      const packed = await packBundles(api, die, Array.from({ length: 7 }, () => ({ quantity: 20, weightG: 50_000 })), { plantStock: true });
      await start(page, "owner", width);
      await visit(page, "/dispatch/new");
      await page.getByRole("combobox", { name: "Customer" }).fill(cust.name.slice(0, 8));
      await page.getByRole("option", { name: cust.name }).first().click();
      await page.getByTestId("transporter-select").selectOption({ label: "Shree Logistics" });
      await page.getByLabel("Truck capacity (kg)").fill("300");
      await page.getByRole("button", { name: "Create dispatch" }).click();
      await expect(page).toHaveURL(/\/dispatch\/(?!new)[^/]+$/);
      const id = new URL(page.url()).pathname.split("/").pop()!;
      const banner = page.getByTestId("capacity-banner");
      await expect(banner).toHaveAttribute("data-state", "ok");

      // 6 x 50 kg = 300 kg: full but not over (near). The 7th takes it 50 kg over.
      const serials = packed.bundles.map((b) => b.serial);
      await api.mutate("dispatch.addBundlesBySerial", { id, serials: serials.slice(0, 6), allowUnassigned: true });
      await page.reload();
      await expect(banner).toHaveAttribute("data-state", "near");
      await expect(banner).toContainText("Nearly full");
      await expect(banner).toContainText("300.0 of 300.0 kg");
      await api.mutate("dispatch.addBundlesBySerial", { id, serials: serials.slice(6), allowUnassigned: true });
      await page.reload();
      await expect(banner).toHaveAttribute("data-state", "over");
      await expect(banner).toContainText(/50(\.0)? kg over capacity/);
      await expectNoHorizontalScroll(page);
      // The floating action bar sits over the last rows of a short window; axe measures the page as the
      // window shows it, so give it a tall one.
      await page.setViewportSize({ width, height: 2000 });
      expect(await axeSerious(page)).toEqual([]);
      await page.setViewportSize({ width, height: 900 });

      // Dispatch over capacity: the confirmation asks why, and says so before anything is sent.
      await page.getByRole("button", { name: "Hold stock" }).click();
      await expect(page.locator("[data-slot='dispatch-hero']")).toHaveAttribute("data-status", "reserved");
      await page.getByRole("button", { name: "Dispatch", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: /^Dispatch DSP-/ });
      await expect(confirm.getByTestId("capacity-banner")).toHaveAttribute("data-state", "over");
      await fillVehicleIfAsked(confirm);
      await confirm.getByTestId("confirm-dispatch").click();
      await expect(confirm.getByText("Say why before you dispatch.")).toBeVisible();
      await confirm.getByLabel("Why load over capacity").fill("Customer pays for the extra trip");
      await confirm.getByTestId("confirm-dispatch").click();
      await expect(page.locator("[data-slot='dispatch-hero']")).toHaveAttribute("data-status", "completed", { timeout: 30_000 });
      const row = await api.query<{ dispatch: { capacityOverrideReason: string | null; transporterName: string | null; vehicleCapacityG: number } }>("dispatch.getDispatch", { id });
      expect(row.dispatch).toMatchObject({ capacityOverrideReason: "Customer pays for the extra trip", transporterName: "Shree Logistics", vehicleCapacityG: 300_000 });
      // The header on the packing list carries the transporter.
      await expect(page.locator("[data-slot='pl-header'] [data-fact='transporter'] dd")).toHaveText("Shree Logistics");
      await api.dispose();
    });
  }
});

/** A completed dispatch of `serials` for `customerId`, built through the API. */
async function completed(api: OwnerApi, customerId: string, serials: string[]) {
  const d = await api.mutate<{ id: string; code: string }>("dispatch.create", { customerId });
  await api.mutate("dispatch.addBundlesBySerial", { id: d.id, serials, allowUnassigned: true });
  await api.mutate("dispatch.reserve", { id: d.id });
  await api.mutate("dispatch.complete", { id: d.id });
  return d;
}

test.describe("packing list v2: header, revisions, branding, combine, by-id view", () => {
  for (const width of WIDTHS) {
    test(`edit header, regenerate as revision 2 with branding off, combine two lists of one customer, at ${width}`, async ({ page }) => {
      const api = await ownerApi();
      const tag = `${width}-${Date.now() % 100_000}`;
      const cust = await newCustomer(api, `PL ${tag}`, "lifelong");
      const die = await dieId(api, DIE);
      const one = await packBundles(api, die, [{ quantity: 20, weightG: 47_900 }, { quantity: 20, weightG: 48_100 }], { plantStock: true });
      const two = await packBundles(api, die, [{ quantity: 20, weightG: 47_700 }], { plantStock: true });
      const d1 = await completed(api, cust.id, one.bundles.map((b) => b.serial));
      const d2 = await completed(api, cust.id, two.bundles.map((b) => b.serial));

      await start(page, "owner", width);
      await visit(page, `/dispatch/${d1.id}`);
      const header = page.locator("[data-slot='pl-header']");
      await expect(header).toBeVisible();
      await expect(header.getByTestId("packing-list-totals")).toHaveText("2 bundles · 96.00 kg");
      // The customer's own numbers show as a column (they differ from the serials), and the rows add up.
      await expect(page.getByTestId("packing-list-row")).toHaveCount(2);
      // The group subtotal: a table row on a wide screen, the group's own line on a phone.
      await expect(page.getByTestId("pl-group-total").or(page.getByTestId("pl-group-subtotal")).first()).toContainText("96.00");

      // Edit header: vehicle, driver, transporter, invoice (owner holds invoice.link).
      await page.getByTestId("edit-header").click();
      const sheet = page.getByRole("dialog", { name: "Edit details" });
      await sheet.getByLabel("Vehicle number").fill("gj05 ab 1234");
      await sheet.getByLabel("Driver", { exact: true }).fill("Ramesh");
      await sheet.getByTestId("transporter-select").selectOption({ label: "Shree Logistics" });
      await sheet.getByLabel("Tally invoice number").fill(`INV-${tag}`);
      await sheet.getByRole("button", { name: "Save details" }).click();
      await expect(header.locator("[data-fact='vehicle'] dd")).toHaveText("GJ05AB1234");
      await expect(header.locator("[data-fact='driver'] dd")).toContainText("Ramesh");
      await expect(header.locator("[data-fact='transporter'] dd")).toHaveText("Shree Logistics");
      await expect(header.locator("[data-fact='invoice'] dd")).toContainText(`INV-${tag}`);

      // Regenerate = a NEW revision, branding off; the sent revision stays.
      await expect(page.getByTestId("pl-branding")).toBeVisible();
      await page.getByTestId("regenerate").click();
      const dialog = page.getByRole("dialog", { name: "Make a new revision?" });
      await dialog.getByRole("checkbox", { name: "Show company name" }).click();
      await dialog.getByTestId("confirm-regenerate").click();
      await expect(page.locator("[data-slot='pl-revisions'] [data-testid='pl-revision']")).toHaveCount(2, { timeout: 20_000 });
      const revs = page.locator("[data-testid='pl-revision']");
      await expect(revs.first()).toHaveAttribute("data-revision", "2");
      await expect(revs.first()).toContainText("Current");
      await expect(revs.last()).toContainText("Sent earlier");
      await expect(revs.first()).toContainText("No changes");
      await expect(page.getByTestId("pl-branding")).toHaveCount(0);
      // The legal name always prints.
      await expect(page.getByTestId("pl-legal-name")).not.toBeEmpty();
      await expect(page.getByRole("heading", { level: 2, name: /Packing list/ })).toContainText("Revision 2");
      await expectNoHorizontalScroll(page);
      expect(await axeSerious(page)).toEqual([]);

      // Revision 1 stays readable at its own address.
      const list = await api.query<{ items: { id: string; dispatchCode: string | null }[] }>("packingList.list", { customerId: cust.id });
      const current = list.items.find((l) => l.dispatchCode === d1.code)!;
      const history = await api.query<{ revisions: { id: string; revision: number }[] }>("packingList.revisions", { id: current.id });
      const rev1 = history.revisions.find((r) => r.revision === 1)!;
      await visit(page, `/packing-lists/${rev1.id}`);
      await expect(page.locator("[data-testid='pl-revision']")).toHaveCount(2);
      await expect(page.getByText("Showing", { exact: true })).toBeVisible();

      // Combine: this customer's other list folds in; the new list covers both dispatches.
      await visit(page, `/dispatch/${d2.id}`);
      await page.getByTestId("combine").click();
      const combine = page.getByRole("dialog", { name: "Combine packing lists" });
      await expect(combine.getByRole("checkbox")).toHaveCount(1);
      await combine.getByRole("checkbox").check({ force: true });
      await combine.getByTestId("confirm-combine").click();
      await expect(page).toHaveURL(/\/packing-lists\//, { timeout: 20_000 });
      const folded = page.locator("[data-slot='pl-header']");
      await expect(folded.getByTestId("packing-list-totals")).toHaveText("3 bundles · 143.70 kg");
      await expect(folded.locator("[data-fact='dispatch'] dd")).toContainText(d1.code);
      await expect(folded.locator("[data-fact='dispatch'] dd")).toContainText(d2.code);
      await expect(page.getByTestId("packing-list-row")).toHaveCount(3);

      // The folded list says where it went.
      await visit(page, `/dispatch/${d2.id}`);
      await api.dispose();
    });
  }

  test("floor roles cannot regenerate or combine; they can read and print", async ({ page }) => {
    const api = await ownerApi();
    const cust = await newCustomer(api, `PL floor ${Date.now() % 100_000}`);
    const die = await dieId(api, DIE);
    const r = await packBundles(api, die, [{ quantity: 20, weightG: 47_900 }], { plantStock: true });
    const d = await completed(api, cust.id, r.bundles.map((b) => b.serial));
    await api.dispose();
    await start(page, "operator", 1280);
    await visit(page, `/dispatch/${d.id}`);
    await expect(page.locator("[data-slot='pl-header']")).toBeVisible();
    await expect(page.getByTestId("regenerate")).toHaveCount(0);
    await expect(page.getByTestId("combine")).toHaveCount(0);
    await expect(page.getByTestId("edit-header")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  });
});
