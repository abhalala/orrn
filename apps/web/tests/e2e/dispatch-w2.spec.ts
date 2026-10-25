import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { toPlantStock } from "./helpers/plant-stock";
import { closeOrders, confirmedOrder, dispatchNow, kg3, m, makeParty, packFor, q } from "./helpers/orders-api";

import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/** A die nobody else packs plant stock for (other specs use the first dies), so the plant group here is exactly ours. */
const DIE = "dev-die-12212";

/**
 * Dispatch from a sales order (W2-OPPK-W, FP-PK-17) and the packing list's optional kg-per-piece
 * column (FP-PK-13). The order's party becomes the dispatch's party, the order panel and the scan
 * screen show the live baki, "Suggest bundles" lists the order's own stock first and then plant
 * stock of the same die and length, and add-all is one tap.
 *
 * Each test makes its own party, orders and bundles over the API and closes its orders at the end.
 */

const WIDTHS = [375, 820, 1280] as const;
test.describe.configure({ timeout: 180_000 });

async function open(page: Page, opts: { role?: LocalRole; width: number; path: string }) {
  await page.setViewportSize({ width: opts.width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(opts.path);
  await expect(page.locator("main h1").first()).toBeAttached({ timeout: 30_000 });
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

type Detail = {
  dispatch: { id: string; customerId: string; salesOrderId: string | null; status: string };
  items: { serial: string }[];
  salesOrder: { number: string; progress: { bakiG: number; onDispatchG: number; leftG: number; overG: number } } | null;
};

/**
 * A party with order A (the one we send against: three bundles packed for it), plus things that
 * must NOT be offered: a bundle for the party's other order B, a bundle held for B's line, and a
 * bundle packed for another customer's order. Plant stock of A's die and length is offered.
 */
async function stage(page: Page) {
  const party = await makeParty(page, "Ship");
  const other = await makeParty(page, "Other");
  // A cut length of this run's own: plant stock lies in the shared yard for good, and the suggestions
  // match on die AND length, so another run's bundles can never be in this run's list.
  const len = 3000 + Math.floor(Math.random() * 900);
  const a = await confirmedOrder(page, party.id, [{ sectionId: DIE, cutLengthMm: len, pcs: 100 }]); // ~ 230 kg
  const b = await confirmedOrder(page, party.id, [{ sectionId: DIE, cutLengthMm: len, pcs: 100 }]);
  const foreign = await confirmedOrder(page, other.id, [{ sectionId: DIE, cutLengthMm: len, pcs: 100 }]);
  const own = await packFor(page, a.lineIds[0]!, [30, 40, 50], { sectionId: DIE, lengthMm: len });
  const plant = await packFor(page, b.lineIds[0]!, [25, 35], { sectionId: DIE, lengthMm: len });
  await toPlantStock(plant);
  const forB = await packFor(page, b.lineIds[0]!, [22], { sectionId: DIE, lengthMm: len });
  const heldForB = await packFor(page, b.lineIds[0]!, [23], { sectionId: DIE, lengthMm: len });
  await toPlantStock(heldForB);
  await m(page, "orders.hold", { lineId: b.lineIds[0]!, bundleIds: await bundleIds(page, heldForB) });
  const forForeign = await packFor(page, foreign.lineIds[0]!, [24], { sectionId: DIE, lengthMm: len });
  return { party, a, b, foreign, own, plant, forB, heldForB, forForeign, ids: [a.id, b.id, foreign.id] };
}

async function bundleIds(page: Page, serials: string[]) {
  const out: string[] = [];
  for (const serial of serials) out.push((await q<{ bundle: { id: string } }>(page, "bundle.getBySerial", { serial })).bundle.id);
  return out;
}

test.describe("dispatch from a sales order", () => {
  for (const width of WIDTHS) {
    test(`Dispatch from the order, the panel, Suggest bundles and add all at ${width}`, async ({ page }) => {
      await open(page, { width, path: "/orders" });
      const s = await stage(page);
      let dispatchId: string | null = null;
      try {
        // From the order's page: Dispatch opens the form on "From sales order" with the order picked.
        await page.goto(`/orders/${s.a.id}`);
        await page.locator("[data-dispatch-from-order]").click();
        await expect(page).toHaveURL(new RegExp(`/dispatch/new\\?salesOrderId=${s.a.id}`));
        await expect(page.getByRole("radio", { name: "From sales order" })).toBeChecked();
        await expect(page.getByRole("combobox", { name: "Sales order" })).toHaveValue(new RegExp(`${s.a.number} · ${s.party.name}`));
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main");
        await page.getByRole("button", { name: "Create dispatch" }).click();
        await page.waitForURL((u) => /^\/dispatch\/(?!new$)[^/]+$/.test(u.pathname));
        dispatchId = new URL(page.url()).pathname.split("/").pop()!;

        const detail = await q<Detail>(page, "dispatch.getDispatch", { id: dispatchId });
        expect(detail.dispatch).toMatchObject({ customerId: s.party.id, salesOrderId: s.a.id, status: "draft" });
        await expect(page.locator("[data-slot='dispatch-hero']")).toContainText(s.party.name);

        // The order's baki is on the page from the start.
        const panel = page.locator(`[data-order-panel='${s.a.number}']`);
        await expect(panel).toBeVisible();
        const baki = detail.salesOrder!.progress.bakiG;
        await expect(panel.locator("[data-order-figure='baki']")).toContainText(`${kg3(baki)} kg`);
        await expect(panel.locator("[data-order-figure='onLoad']")).toContainText("0.000 kg");
        await expect(panel.locator("[data-order-figure='left']")).toContainText(`${kg3(baki)} kg`);

        // Suggest bundles: this order's stock first, then plant stock of the same die and length.
        await page.getByRole("button", { name: "Suggest bundles" }).click();
        const sheet = page.getByRole("dialog", { name: "Suggest bundles" });
        await expect(sheet.locator("[data-suggest-group='order']")).toBeVisible();
        const orderRows = sheet.locator("[data-suggest-group='order'] [data-suggest-serial]");
        const plantRows = sheet.locator("[data-suggest-group='plant'] [data-suggest-serial]");
        await expect(orderRows).toHaveCount(3);
        await expect(plantRows).toHaveCount(2);
        expect(await orderRows.evaluateAll((els) => els.map((e) => e.getAttribute("data-suggest-serial")))).toEqual(s.own);
        expect((await plantRows.evaluateAll((els) => els.map((e) => e.getAttribute("data-suggest-serial")))).sort()).toEqual([...s.plant].sort());
        // Not offered: the party's other order, a bundle held for another line, another customer's.
        for (const serial of [...s.forB, ...s.heldForB, ...s.forForeign]) await expect(sheet.locator(`[data-suggest-serial='${serial}']`)).toHaveCount(0);
        // The order group comes before the plant group on the page.
        const groups = await sheet.locator("[data-suggest-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-suggest-group")));
        expect(groups).toEqual(["order", "plant"]);
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "[data-slot='sheet']");
        if (width === 375) expect(await axeViolations(page)).toEqual([]);

        // One tap adds everything that fits; the panel follows.
        await sheet.locator("[data-suggest-add-all]").click();
        await expect(sheet.getByRole("status")).toContainText("Added 5 bundles");
        await expect(sheet.locator("[data-suggest-serial]")).toHaveCount(0);
        await expect(sheet.locator("[data-suggest-empty]")).toBeVisible();
        await sheet.getByRole("button", { name: "Done" }).click();
        await expect(page.getByTestId("dispatch-bundles")).toHaveText("5");
        const addedKg = (30 + 40 + 50 + 25 + 35) * 1000;
        await expect(panel.locator("[data-order-figure='onLoad']")).toContainText(`${kg3(addedKg)} kg`);
        await expect(panel.locator("[data-order-figure='left']")).toContainText(`${kg3(Math.max(0, baki - addedKg))} kg`);
        const after = await q<Detail>(page, "dispatch.getDispatch", { id: dispatchId });
        expect(after.items.map((i) => i.serial).sort()).toEqual([...s.own, ...s.plant].sort());
        // Every bundle meets A's line, the plant stock too (the order's own line first).
        expect(after.salesOrder!.progress).toMatchObject({ onDispatchG: addedKg });
      } finally {
        if (dispatchId) await m(page, "dispatch.cancel", { id: dispatchId }).catch(() => undefined);
        await closeOrders(page, s.ids);
      }
    });
  }

  test("the scan screen shows the order's live baki and it falls with each bundle", async ({ page }) => {
    await open(page, { width: 390, path: "/orders" });
    const party = await makeParty(page, "Scan");
    const o = await confirmedOrder(page, party.id, [{ pcs: 100 }]);
    // The line's own kg/12ft (Q36): one bundle exactly on it, two a kg or more per piece heavier (off).
    const basis = (await q<{ lines: { kgPer12ftMilli: number }[] }>(page, "orders.get", { id: o.id })).lines[0]!.kgPer12ftMilli;
    const onKg = (basis * 10) / 1000;
    const serials = await packFor(page, o.lineIds[0]!, [onKg, onKg + 10, onKg + 25]);
    const made = await m<{ id: string }>(page, "dispatch.create", { salesOrderId: o.id });
    try {
      await page.goto(`/dispatch/${made.id}`);
      await expect(page.locator(`[data-order-panel='${o.number}']`)).toBeVisible();
      const before = (await q<Detail>(page, "dispatch.getDispatch", { id: made.id })).salesOrder!.progress;
      await page.getByRole("button", { name: "Scan bundles" }).click();
      const sheet = page.getByRole("dialog", { name: /Scanning into/ });
      const line = sheet.locator("[data-scan-order]");
      await expect(line).toContainText(`${o.number}: baki ${kg3(before.bakiG)} kg, ${kg3(before.leftG)} kg left after this load`);

      const field = sheet.getByLabel("Serial or label link");
      await field.fill(serials[0]!);
      await field.press("Enter");
      await expect(sheet.getByTestId("scan-count")).toHaveText("1 added");
      await expect(line).toContainText(`${kg3(before.leftG - onKg * 1000)} kg left after this load`);
      // On the line's weight: no warning.
      await expect(sheet.locator("[data-scan-warning]")).toHaveCount(0);
      // Off it (Q36): added all the same, with the warning in the scan result.
      await field.fill(serials[1]!);
      await field.press("Enter");
      await expect(sheet.getByTestId("scan-count")).toHaveText("2 added");
      await expect(line).toContainText(`${kg3(before.leftG - (onKg * 2 + 10) * 1000)} kg left after this load`);
      await expect(sheet.locator("[data-scan-warning]")).toContainText(`${o.number} says ${(basis / 1000).toFixed(3)}. Check the weight.`);
      await expect(sheet.getByRole("status")).toContainText(`Added ${serials[1]}`);
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "[data-slot='sheet']");
      await sheet.getByRole("button", { name: "Done scanning" }).click();
      // The draft marks the bundles off their line, never the one on it.
      await page.getByRole("button", { name: "Suggest bundles" }).click();
      await page.getByRole("dialog", { name: "Suggest bundles" }).getByRole("button", { name: "Done" }).click();
      await expect(page.locator(`[data-serial='${serials[1]}'] [data-off-band]`).first()).toBeVisible();
      await expect(page.locator(`[data-serial='${serials[0]}'] [data-off-band]`)).toHaveCount(0);
      const got = await q<{ items: { serial: string; offBand: boolean }[] }>(page, "dispatch.getDispatch", { id: made.id });
      expect(got.items.map((i) => [i.serial, i.offBand]).sort()).toEqual([[serials[0], false], [serials[1], true]].sort());
    } finally {
      await m(page, "dispatch.cancel", { id: made.id }).catch(() => undefined);
      await closeOrders(page, [o.id]);
    }
  });

  test("a dispatch from an order keeps its customer; the form asks for an order; a plain dispatch has no panel", async ({ page }) => {
    await open(page, { width: 1280, path: "/dispatch/new" });
    const party = await makeParty(page, "Form");
    const o = await confirmedOrder(page, party.id, [{ pcs: 10 }]);
    const made: string[] = [];
    try {
      // Nothing picked: asked for the order, not the customer.
      await page.getByRole("radio", { name: "From sales order" }).check();
      await page.getByRole("button", { name: "Create dispatch" }).click();
      await expect(page.getByText("Pick the sales order.")).toBeVisible();
      await page.getByRole("combobox", { name: "Sales order" }).fill(o.number);
      await page.getByRole("option", { name: new RegExp(`${o.number} · ${party.name}`) }).click();
      await page.getByRole("button", { name: "Create dispatch" }).click();
      await page.waitForURL((u) => /^\/dispatch\/(?!new$)[^/]+$/.test(u.pathname));
      made.push(new URL(page.url()).pathname.split("/").pop()!);
      await expect(page.locator(`[data-order-panel='${o.number}']`)).toBeVisible();
      // The list names the order.
      const list = await q<{ items: { id: string; salesOrderNumber: string | null }[] }>(page, "dispatch.listDispatches", { customerId: party.id });
      expect(list.items.find((i) => i.id === made[0])!.salesOrderNumber).toBe(o.number);
      // An ordinary dispatch has no panel and no Suggest button.
      const plain = await m<{ id: string }>(page, "dispatch.create", { customerId: party.id });
      made.push(plain.id);
      await page.goto(`/dispatch/${plain.id}`);
      await expect(page.getByRole("button", { name: "Scan bundles" })).toBeVisible();
      await expect(page.locator("[data-order-panel]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Suggest bundles" })).toHaveCount(0);
    } finally {
      for (const id of made) await m(page, "dispatch.cancel", { id }).catch(() => undefined);
      await closeOrders(page, [o.id]);
    }
  });
});

test.describe("packing list: kg per piece", () => {
  test.describe.configure({ mode: "serial" });
  test("off by default; the owner switches it on for the plant and the column shows; the office sees it but cannot change it", async ({ page }) => {
    await open(page, { width: 1280, path: "/orders" });
    const party = await makeParty(page, "Pack");
    const o = await confirmedOrder(page, party.id, [{ pcs: 100 }]);
    const serials = await packFor(page, o.lineIds[0]!, [30, 45]);
    const sent = await dispatchNow(page, o.id, serials);
    await m(page, "company.updateSettings", { packingList: { kgPerPiece: false } });
    try {
      await page.goto(`/dispatch/${sent.id}`);
      const table = page.getByTestId("packing-list-table");
      await expect(table).toBeVisible();
      const toggle = page.getByTestId("kg-per-piece-toggle").getByRole("checkbox");
      await expect(toggle).not.toBeChecked();
      await expect(table.getByRole("columnheader", { name: "kg/pc" })).toHaveCount(0);
      await expect(table.getByRole("columnheader", { name: "Weight range /12'" }).or(table.getByRole("columnheader", { name: /range/i })).first()).toBeVisible();

      await toggle.click();
      await expect(toggle).toBeChecked();
      await expect(table.getByRole("columnheader", { name: "kg/pc" })).toBeVisible();
      // 30 kg over 10 pieces, 45 kg over 10: the column is weight over pieces to the gram.
      await expect(page.getByTestId("packing-list-kg-per-piece")).toHaveText(["3.000", "4.500"]);
      expect((await q<{ packingList: { kgPerPiece: boolean } }>(page, "company.getSettings", {})).packingList.kgPerPiece).toBe(true);
      // Excel and PDF carry it too: the files are made on click from the same switch.
      const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Excel" }).click()]);
      expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
      await expectNoHorizontalScroll(page);

      // Persisted per company: a reload and another role see it; only settings.update can change it.
      await page.reload();
      await expect(page.getByTestId("packing-list-table").getByRole("columnheader", { name: "kg/pc" })).toBeVisible();
      const office = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
      const op = await office.newPage();
      await open(op, { role: "office", width: 1280, path: `/dispatch/${sent.id}` });
      await expect(op.getByTestId("packing-list-table").getByRole("columnheader", { name: "kg/pc" })).toBeVisible();
      await expect(op.getByTestId("kg-per-piece-toggle")).toHaveCount(0);
      await office.close();

      // Narrow screens show it as a fact on each row.
      await page.setViewportSize({ width: 375, height: 900 });
      await page.reload();
      await expect(page.getByText("kg/pc").first()).toBeVisible();
      await expectNoHorizontalScroll(page);

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.reload();
      await page.getByTestId("kg-per-piece-toggle").getByRole("checkbox").click();
      await expect(page.getByTestId("packing-list-table").getByRole("columnheader", { name: "kg/pc" })).toHaveCount(0);
    } finally {
      await m(page, "company.updateSettings", { packingList: { kgPerPiece: false } });
      await closeOrders(page, [o.id]);
    }
  });
});

test.describe("what one packing list carries (Q37)", () => {
  test.describe.configure({ mode: "serial" });
  for (const width of WIDTHS) {
    test(`the owner sets the mode in Printing; several customers can share a truck at ${width}`, async ({ page }) => {
      await open(page, { width, path: "/settings?tab=printing" });
      const a = await makeParty(page, "TruckA");
      const b = await makeParty(page, "TruckB");
      let first: string | null = null;
      let second: string | null = null;
      try {
        const card = page.getByTestId("packing-list-scope");
        await expect(card.getByRole("radio", { name: "One customer" })).toBeChecked();
        await expect(page.getByTestId("packing-list-scope-body")).toContainText("Each packing list is for one customer.");
        // One order: set and put straight back (the setting is the whole plant's).
        await card.getByRole("radio", { name: "One order" }).click();
        await expect(card.getByRole("radio", { name: "One order" })).toBeChecked();
        await expect(page.getByTestId("packing-list-scope-body")).toContainText("Each packing list is for one sales order.");
        await card.getByRole("radio", { name: "One customer" }).click();
        await expect(card.getByRole("radio", { name: "One customer" })).toBeChecked();
        await expect.poll(async () => (await q<{ packingList: { scope: string } }>(page, "company.getSettings", {})).packingList.scope).toBe("one_customer");

        await card.getByRole("radio", { name: "Several per truck" }).click();
        await expect(card.getByRole("radio", { name: "Several per truck" })).toBeChecked();
        await expect(page.getByTestId("packing-list-scope-body")).toContainText("Each customer has its own packing list");
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main");
        expect((await q<{ packingList: { scope: string } }>(page, "company.getSettings", {})).packingList.scope).toBe("per_truck");

        // The dispatch form says the mode and offers a truck.
        await page.goto("/dispatch/new");
        await expect(page.locator("[data-dispatch-scope='per_truck']")).toBeVisible();
        await expect(page.getByLabel("Same truck as")).toBeVisible();

        // Customer A's dispatch, with a vehicle; then B joins its truck from A's page.
        const one = await m<{ id: string; code: string }>(page, "dispatch.create", { customerId: a.id });
        first = one.id;
        await m(page, "dispatch.update", { id: one.id, vehicleNo: "GJ05TR0001", driverName: "Ramesh" });
        await page.goto(`/dispatch/${one.id}`);
        await expect(page.locator("[data-truck-panel]")).toBeVisible();
        await page.locator("[data-truck-add]").click();
        await expect(page).toHaveURL(new RegExp(`/dispatch/new\\?truckOf=${one.id}`));
        await expect(page.getByLabel("Same truck as")).toHaveValue(one.id);
        await page.getByRole("combobox", { name: "Customer" }).fill(b.name.slice(0, 10));
        await page.getByRole("option", { name: new RegExp(b.name) }).click();
        await page.getByRole("button", { name: "Create dispatch" }).click();
        await page.waitForURL((u) => /^\/dispatch\/(?!new$)[^/]+$/.test(u.pathname));
        second = new URL(page.url()).pathname.split("/").pop()!;
        const panel = page.locator("[data-truck-panel]");
        await expect(panel.locator("[data-truck-dispatch]")).toHaveCount(2);
        await expect(panel).toContainText(a.name);
        await expect(panel).toContainText(b.name);
        const got = await q<{ dispatch: { vehicleNo: string; driverName: string; truckId: string; customerId: string } }>(page, "dispatch.getDispatch", { id: second });
        expect(got.dispatch).toMatchObject({ vehicleNo: "GJ05TR0001", driverName: "Ramesh", truckId: one.id, customerId: b.id });
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main");
      } finally {
        await m(page, "company.updateSettings", { packingList: { scope: "one_customer" } });
        for (const id of [first, second]) if (id) await m(page, "dispatch.cancel", { id }).catch(() => undefined);
      }
    });
  }

  test("a plant on one customer per list shows no truck picker; the office sees the mode but cannot change it", async ({ page }) => {
    await open(page, { width: 1280, path: "/dispatch/new" });
    await expect(page.locator("[data-dispatch-scope='one_customer']")).toBeVisible();
    await expect(page.getByLabel("Same truck as")).toHaveCount(0);
    const office = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
    const op = await office.newPage();
    await open(op, { role: "office", width: 1280, path: "/settings?tab=printing" });
    await expect(op.getByTestId("packing-list-scope")).toContainText("One customer");
    await expect(op.getByTestId("packing-list-scope").getByRole("radio")).toHaveCount(0);
    await office.close();
  });
});
