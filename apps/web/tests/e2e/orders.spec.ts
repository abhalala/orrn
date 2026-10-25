import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Orders and planning (W1-OP-W, FP-OP): the order list with the seeded SO-1 (late) / SO-2 / SO-3
 * (booking), the new-order form with the live quote, confirm blockers, the balance strip, the
 * reallocate sheet (applied to plant stock, pending for another customer), the press plan board,
 * and who sees which buttons.
 *
 * Seed (apps/server/src/dev-seed-orders.ts): SO-1 confirmed 25 days ago for KD Extrusion, PO-4471,
 * line 1 die 14701 (200 pcs, two bundles packed for it), line 2 die 11250; SO-2 confirmed for Royal
 * Aluminium, PO-118; SO-3 a booking with no PO. office books and plans; viewer only reads.
 */

const SHOTS = process.env.W1_OP_W_SHOTS_DIR;
const WIDTHS = [375, 820, 1280] as const;

async function open(page: Page, opts: { role: LocalRole; width: number; path: string; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role);
  await page.goto(opts.path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function settled(page: Page) {
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({ baseURL: ORIGIN });
  return context.newPage();
}

async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page
    .context()
    .request.get(`${API}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function trpcMutation<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API}/trpc/${path}`, { headers: { origin: ORIGIN }, data: input });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function blockingAxeViolations(page: Page) {
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

function toast(page: Page, text: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

const kg3 = (grams: number) => (grams / 1000).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

type OrderRow = { id: string; number: string; status: string };

/** A booking for Royal Aluminium on die 14701 at the given cut length, made over the API as office. */
async function apiBooking(page: Page, cutLengthMm: number, po: string) {
  return trpcMutation<OrderRow>(page, "orders.create", {
    customerId: "dev-customer-royal",
    poNumber: po,
    lines: [{ sectionId: "dev-die-14701", cutLengthMm, qtyBasis: "pcs", pcs: 10, tierRank: 1 }],
  });
}

type Line = { sectionId: string; cutLengthMm?: number; pcs: number };
type GotOrder = {
  order: { id: string; number: string; status: string; serverSeq: number };
  lines: { lineId: string; lineNo: number; orderedPcs: number | null; orderedG: number }[];
};

/** A confirmed order made over the API (office): booked with a PO, then confirmed. */
async function apiConfirmed(page: Page, customerId: string, lines: Line[]) {
  const po = `E2E-${Math.random().toString(36).slice(2, 10)}`;
  const made = await trpcMutation<OrderRow>(page, "orders.create", {
    customerId,
    poNumber: po,
    lines: lines.map((l) => ({ sectionId: l.sectionId, cutLengthMm: l.cutLengthMm ?? 3658, qtyBasis: "pcs", pcs: l.pcs, tierRank: 1 })),
  });
  const got = await trpcQuery<GotOrder>(page, "orders.get", { id: made.id });
  await trpcMutation(page, "orders.confirm", { id: made.id, serverSeq: got.order.serverSeq });
  return { ...made, po, lines: got.lines };
}


/** Two presses in the seed (P1, and P2 for die trials): a plan drafted on the board names P1. */
async function pickPress(page: Page) {
  await page.getByRole("combobox", { name: "Press", exact: true }).selectOption({ label: "P1 · Press 1" });
}

test.describe("orders list and detail", () => {
  for (const width of WIDTHS) {
    test(`the list shows SO-1 (late), SO-2 and SO-3 (booking) at ${width}`, async ({ page }) => {
      await open(page, { role: "office", width, path: "/orders" });
      await settled(page);
      const main = page.locator("main#main");
      for (const n of ["SO-1", "SO-2", "SO-3"]) await expect(main.getByText(n, { exact: true })).toBeVisible();
      // The PO is the document: the whole number shows.
      await expect(main.getByText("PO-4471", { exact: true })).toBeVisible();
      await expect(main.getByText("PO-118", { exact: true })).toBeVisible();
      // SO-3 has no PO yet. Other specs (pack-w1) book orders without a PO too, so read SO-3's own row.
      const so3 = main.locator("li, tr").filter({ has: page.getByText("SO-3", { exact: true }) });
      await expect(so3.getByText("No PO yet")).toBeVisible();
      // Only SO-1 is past 15 days. Scoped to the seeded orders' own rows: other specs (orders-w2's overdue Book
      // Traders order, the demo plant's own late order) legitimately add Late rows to the shared list (BACKLOG 56).
      const rowOf = (n: string) => main.locator("li, tr").filter({ has: page.getByText(n, { exact: true }) });
      await expect(rowOf("SO-1").getByText(/Late, \d+ days/)).toHaveCount(1);
      await expect(rowOf("SO-2").getByText(/Late, \d+ days/)).toHaveCount(0);
      await expect(rowOf("SO-3").getByText(/Late, \d+ days/)).toHaveCount(0);
      // Other tests in this file book and confirm orders of their own, so these are "at least".
      // (the Status filter's options say the same words: look at the chips)
      await expect(main.locator("[data-slot='chip']").filter({ hasText: /^Booking$/ }).first()).toBeVisible();
      await expect(main.locator("[data-slot='chip']").filter({ hasText: /^Confirmed$/ }).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main#main");
      await shot(page, `list-${width}`);

      // The segments filter on the server.
      // (the filter lives in the URL, so the radio settles a beat after the click)
      await page.getByRole("radio", { name: "Closed" }).click();
      await expect(page.getByRole("radio", { name: "Closed" })).toBeChecked();
      // Other specs close the orders they make, so the Closed list is not empty; the seeded open orders are not in it.
      await expect(main.getByText("SO-1", { exact: true })).toHaveCount(0);
      await expect(main.getByText("SO-2", { exact: true })).toHaveCount(0);
      await page.getByRole("radio", { name: "Open" }).click();
      await expect(page.getByRole("radio", { name: "Open" })).toBeChecked();
      await page.getByRole("textbox", { name: "Search orders" }).fill("PO-118");
      await expect(main.getByText("SO-2", { exact: true })).toBeVisible();
      await expect(main.getByText("SO-1", { exact: true })).toHaveCount(0);
    });

    test(`SO-1 shows the balance strip: ordered, produced, dispatched, baki at ${width}`, async ({ page }) => {
      await open(page, { role: "office", width, path: "/orders/dev-so-1" });
      await settled(page);
      await expect(page.getByRole("heading", { name: "SO-1", level: 1 })).toBeVisible();
      const totals = page.locator("[data-order-totals]");
      await expect(totals.locator("[data-total='ordered']")).toContainText("1,280.000 kg");
      await expect(totals.locator("[data-total='dispatched']")).toContainText("0.000 kg");
      await expect(totals.locator("[data-total='baki']")).toContainText("1,280.000 kg");
      await expect(totals.locator("[data-total='produced']")).toContainText(/\d[\d,]*\.\d{3} kg/);
      // Eight figures on each line; the baki cell is the ordered kg while nothing is dispatched.
      const line1 = page.locator("[data-order-line='1']");
      for (const label of ["Ordered", "Planned", "Pressed", "Aged", "Packed (incl. dispatched)", "In stock", "Dispatched", "Baki"]) {
        await expect(line1.getByText(label, { exact: true })).toBeVisible();
      }
      await expect(line1.locator("[data-strip='orderedG']")).toContainText("480.000 kg");
      await expect(line1.locator("[data-strip='orderedG']")).toContainText("200 pcs");
      await expect(line1.locator("[data-strip='bakiG']")).toContainText("480.000 kg");
      await expect(line1.locator("[data-strip='bakiG']")).toContainText("200 pcs");
      await expect(line1.locator("[data-strip='dispatchedG']")).toContainText("0.000 kg");
      // Late, the booking and the confirmation in the timeline.
      await expect(page.getByText(/Late, \d+ days/)).toBeVisible();
      await expect(page.locator("[data-timeline='order.create']")).toContainText("Order booked");
      await expect(page.locator("[data-timeline='order.confirm']")).toContainText("Order confirmed");
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main#main");
      await shot(page, `detail-so1-${width}`);
    });
  }

  test("axe is clean on the list, the detail and the new-order form", async ({ page }) => {
    test.setTimeout(120_000);
    for (const width of [375, 1280]) {
      await open(page, { role: "office", width, path: "/orders" });
      for (const path of ["/orders", "/orders/dev-so-1", "/orders/dev-so-3", "/orders/new"]) {
        await page.goto(path);
        await expect(page.locator("main#main h1").first()).toBeVisible();
        await settled(page);
        expect(await blockingAxeViolations(page), `${path} at ${width}`).toEqual([]);
      }
    }
  });
});

test.describe("book and confirm", () => {
  test.describe.configure({ mode: "serial" });

  test("a booking by pieces quotes the kg, confirm waits for the PO, then confirms", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { role: "office", width: 375, path: "/orders/new" });
    await page.getByRole("combobox", { name: "Customer" }).fill("KD");
    await page.getByRole("option", { name: /KD Extrusion/ }).click();
    await page.getByRole("combobox", { name: "Die", exact: true }).fill("14701");
    await page.getByRole("option", { name: /14701/ }).first().click();
    await page.getByLabel("Die copy").selectOption({ label: "Tier 1 or better" });
    await page.getByRole("button", { name: "12 ft" }).click();
    await page.getByRole("textbox", { name: "Pieces" }).fill("30");

    // The other side comes from the server's quote for exactly these inputs.
    const quote = await trpcQuery<{ kgG: number; basisMilli: number }>(page, "orders.quote", {
      sectionId: "dev-die-14701",
      cutLengthMm: 3658,
      qtyBasis: "pcs",
      pcs: 30,
      weightBasis: "copy_current",
    });
    const quoted = page.locator("[data-quote]");
    await expect(quoted).toContainText(`30 pcs come to ${kg3(quote.kgG)} kg`);
    await expect(page.getByRole("textbox", { name: "kg", exact: true })).toHaveValue((quote.kgG / 1000).toFixed(3));
    await expect(quoted).toContainText(`${(quote.basisMilli / 1000).toFixed(3)} kg/12ft`);

    // Ready stock of this die is a separate prompt, not a length button.
    await expect(page.locator("[data-stock-prompt]")).toContainText(/ready stock/i);
    await page.getByRole("button", { name: "See stock" }).click();
    await expect(page.getByRole("dialog", { name: "Stock for this die and length" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
    await shot(page, "new-375");

    await page.getByRole("button", { name: "Book order" }).click();
    await expect(page).toHaveURL(/\/orders\/[^/]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/SO-\d+/);
    await expect(page.getByText("Booking", { exact: true })).toBeVisible();
    const checklist = page.locator("[data-confirm-checklist]");
    await expect(checklist).toContainText("Add the PO number.");

    // Confirm without the PO: refused with the blocker in words.
    await page.getByRole("button", { name: "Confirm order" }).click();
    await expect(page.locator("[data-order-error]")).toContainText("Add the PO number.");
    await expect(page.getByText("Booking", { exact: true })).toBeVisible();

    // Add the PO, then confirm.
    const po = `E2E-${Date.now()}`;
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "PO number" }).fill(po);
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(po).first()).toBeVisible();
    await expect(checklist).toHaveCount(0);
    await page.getByRole("button", { name: "Confirm order" }).click();
    await expect(toast(page, "Order confirmed")).toBeVisible();
    await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm order" })).toHaveCount(0);

    const id = new URL(page.url()).pathname.split("/").pop()!;
    const order = await trpcQuery<{ order: { status: string; poNumber: string }; lines: { orderedPcs: number; orderedG: number }[] }>(page, "orders.get", { id });
    expect(order.order.status).toBe("confirmed");
    expect(order.order.poNumber).toBe(po);
    expect(order.lines[0]).toMatchObject({ orderedPcs: 30, orderedG: quote.kgG });
    await shot(page, "detail-confirmed-375");
  });

  test("typing kg shows the pieces it comes to, with the piece nudge", async ({ page }) => {
    await open(page, { role: "office", width: 1280, path: "/orders/new" });
    await page.getByRole("combobox", { name: "Die", exact: true }).fill("14701");
    await page.getByRole("option", { name: /14701/ }).first().click();
    await page.getByRole("button", { name: "12 ft" }).click();
    await page.getByRole("textbox", { name: "kg", exact: true }).fill("100");
    const quote = await trpcQuery<{ pcs: number; impliedG: number }>(page, "orders.quote", {
      sectionId: "dev-die-14701",
      cutLengthMm: 3658,
      qtyBasis: "kg",
      kgG: 100_000,
      weightBasis: "copy_current",
    });
    await expect(page.getByRole("textbox", { name: "Pieces" })).toHaveValue(String(quote.pcs));
    await expect(page.locator("[data-quote]")).toContainText(`${quote.pcs} pcs weigh ${kg3(quote.impliedG)} kg. You typed 100.000 kg.`);
    await page.getByRole("button", { name: "+1 piece" }).click();
    await expect(page.getByRole("textbox", { name: "Pieces" })).toHaveValue(String(quote.pcs + 1));
    // Review I-5: the derived side follows the new pieces; the old 100 kg quote is never shown as current.
    const next = await trpcQuery<{ kgG: number }>(page, "orders.quote", {
      sectionId: "dev-die-14701",
      cutLengthMm: 3658,
      qtyBasis: "pcs",
      pcs: quote.pcs + 1,
      weightBasis: "copy_current",
    });
    await expect(page.locator("[data-quote]")).toContainText(`${quote.pcs + 1} pcs come to ${kg3(next.kgG)} kg`);
    await expect(page.getByRole("textbox", { name: "kg", exact: true })).toHaveValue((next.kgG / 1000).toFixed(3));
    await expect(page.locator("[data-quote]")).not.toContainText(`${quote.pcs} pcs weigh`);
    await shot(page, "new-1280");
  });

  test("an incomplete form says what is missing", async ({ page }) => {
    await open(page, { role: "office", width: 375, path: "/orders/new" });
    await page.getByRole("button", { name: "Book order" }).click();
    await expect(page.getByText("Pick the customer.")).toBeVisible();
    await expect(page.getByText("Pick the die.")).toBeVisible();
    await expect(page.getByText("Enter the cut length.")).toBeVisible();
    await expect(page.getByText("Enter pieces or kg.")).toBeVisible();
    await expect(page).toHaveURL(/\/orders\/new$/);
  });
});

test.describe("reallocate reasons come from Masters (W4-MASTERS review I-3)", () => {
  test("the Move sheet offers a code the plant added and not a retired one", async ({ page }) => {
    const tag = Date.now().toString(36);
    const keptLabel = `E2E rush ${tag}`;
    const goneLabel = `E2E retired ${tag}`;
    await signInViaApi(page, "owner");
    const kept = await trpcMutation<{ id: string; code: string }>(page, "reasonCodes.create", { kind: "reallocate", label: keptLabel });
    const gone = await trpcMutation<{ id: string; code: string }>(page, "reasonCodes.create", { kind: "reallocate", label: goneLabel });
    await trpcMutation(page, "reasonCodes.setActive", { id: gone.id, active: false });
    try {
      await open(page, { role: "office", width: 820, path: "/orders/dev-so-1" });
      await settled(page);
      await page.locator("[data-order-line='1']").getByRole("button", { name: "Move bundles" }).click();
      const sheet = page.getByRole("dialog", { name: "Move to another order" });
      await expect(sheet).toBeVisible();
      const reason = sheet.getByLabel("Reason", { exact: true });
      await expect(reason.locator("option", { hasText: keptLabel })).toHaveCount(1);
      await expect(reason.locator("option", { hasText: goneLabel })).toHaveCount(0);
      await expect(reason.locator("option", { hasText: "Customer asked" })).toHaveCount(1);
      await reason.selectOption(kept.code);
      await expect(reason).toHaveValue(kept.code);
    } finally {
      await signInViaApi(page, "owner");
      await trpcMutation(page, "reasonCodes.setActive", { id: kept.id, active: false });
    }
  });
});

test.describe("reallocate", () => {
  test.describe.configure({ mode: "serial" });

  test("SO-1 bundles to plant stock apply at once (phone sheet)", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, { role: "office", width: 375, path: "/orders/dev-so-1" });
    await settled(page);
    await page.locator("[data-order-line='1']").getByRole("button", { name: "Move bundles" }).click();
    const sheet = page.getByRole("dialog", { name: "Move to another order" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Move", exact: true })).toBeDisabled();
    await sheet.getByRole("checkbox").first().click();
    await sheet.getByLabel("Reason", { exact: true }).selectOption("customer_request");
    await expect(sheet.getByText("Plant stock applies at once")).toBeVisible();
    await shot(page, "reallocate-375");
    await sheet.getByRole("button", { name: "Move", exact: true }).click();
    await expect(sheet.locator("[data-reallocate-result='applied']")).toContainText("1 bundle moved");
    await sheet.getByRole("button", { name: "Done" }).click();
    const plant = await trpcQuery<{ total: number }>(page, "orders.plantStock", { sectionId: "dev-die-14701" });
    expect(plant.total).toBeGreaterThanOrEqual(1);
    // BACKLOG 34: the timeline says how many bundles, their kg and from -> to, with the server's figures.
    const timeline = await trpcQuery<{ events: { action: string; move: { count: number; kgG: number } | null }[] }>(page, "orders.timeline", { id: "dev-so-1" });
    const move = timeline.events.filter((e) => e.action === "order.reallocate").at(-1)!.move!;
    expect(move.count).toBe(1);
    expect(move.kgG).toBeGreaterThan(0);
    await expect(
      page.locator("[data-timeline='order.reallocate']").filter({ hasText: `1 bundle, ${kg3(move.kgG)} kg, moved from KD Extrusion to plant stock` }),
    ).not.toHaveCount(0);
  });

  test("SO-1 bundles to another customer wait for a manager, with a length warning; the owner sees what moves and approves", async ({ page, browser }) => {
    test.setTimeout(90_000);
    await open(page, { role: "office", width: 1280, path: "/orders/dev-so-1" });
    // Another customer's order for the same die, cut to a different length.
    const target = await apiBooking(page, 5486, `E2E-R-${Date.now()}`);
    await page.reload();
    await settled(page);
    await page.locator("[data-order-line='1']").getByRole("button", { name: "Move bundles" }).click();
    const sheet = page.getByRole("dialog", { name: "Move to another order" });
    await sheet.getByRole("checkbox").first().click();
    const dest = sheet.getByLabel("Move to", { exact: true });
    const value = await dest.locator("option", { hasText: `${target.number} · Royal Aluminium` }).getAttribute("value");
    await dest.selectOption(value!);
    await expect(sheet.getByText("This is another customer's order. A manager approves the move.")).toBeVisible();
    await expect(sheet.locator("[data-length-warning]")).toContainText(`The cut length differs from ${target.number} line 1 (18 ft)`);
    // Review m-7: the PO is not cut by the select; it sits on its own line.
    await expect(sheet.locator("[data-reallocate-target]")).toContainText("E2E-R-");
    // The length differs: a reason is needed before it can be asked.
    await expect(sheet.getByRole("button", { name: "Ask for approval" })).toBeDisabled();
    await sheet.getByLabel("Reason", { exact: true }).selectOption("length_mismatch");
    await shot(page, "reallocate-pending-1280");
    await sheet.getByRole("button", { name: "Ask for approval" }).click();
    const result = sheet.locator("[data-reallocate-result='pending']");
    await expect(result).toContainText("Waiting for a manager");
    await expect(result.getByRole("link", { name: "See the request" })).toBeVisible();
    await sheet.getByRole("button", { name: "Done" }).click();

    // The order page says so, and nothing moved.
    const pending = page.locator("[data-pending-request]");
    await expect(pending).toContainText("Waiting for a manager");
    await expect(pending).toContainText(target.number);
    await expect(pending.getByRole("link", { name: "See the request" })).toHaveAttribute("href", /\/approvals\?kind=order_reallocate/);
    const list = await trpcQuery<{ items: { status: string; bundles: number }[] }>(page, "orders.reallocations.list", { orderId: "dev-so-1", status: "pending" });
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    expect(list.items[0]).toMatchObject({ status: "pending", bundles: 1 });
    await shot(page, "detail-pending-1280");

    // BACKLOG 34: the owner (not the requester) sees what moves before deciding: the bundle and its
    // kg, from KD's SO-1 line 1 to the target line, and the reason.
    const timeline = await trpcQuery<{ events: { action: string; meta: { status: string }; move: { count: number; kgG: number } | null }[] }>(
      page,
      "orders.timeline",
      { id: target.id },
    );
    const asked = timeline.events.filter((e) => e.action === "order.reallocate" && e.meta.status === "pending").at(-1)!.move!;
    const kg = kg3(asked.kgG);
    // Review m-8: the approver decides on a phone (375 px), the narrowest width the sheet must fit.
    const owner = await newPage(browser);
    await owner.setViewportSize({ width: 375, height: 812 });
    await signInViaApi(owner, "owner");
    await owner.goto("/approvals?kind=order_reallocate");
    const card = owner.getByTestId("approval-card").filter({ hasText: `Royal Aluminium ${target.number}` });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`1 bundle, ${kg} kg: KD Extrusion to Royal Aluminium ${target.number}`);
    await card.getByRole("button", { name: /^Review/ }).click();
    const review = owner.getByRole("dialog");
    const summary = review.getByTestId("move-summary");
    await expect(summary).toContainText(`1 bundle, ${kg} kg`);
    await expect(summary).toContainText("KD Extrusion, SO-1 line 1");
    await expect(summary).toContainText(`Royal Aluminium, ${target.number} line 1`);
    await expect(summary).toContainText("Reason");
    await expect(review.getByTestId("move-bundles").locator("li")).toHaveCount(1);
    await expect(review.getByTestId("move-bundles")).toContainText(`${kg} kg`);
    await expectNoHorizontalScroll(owner);
    const box = await summary.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await review.getByRole("button", { name: "Approve" }).click();
    await expect(review).toHaveCount(0);

    // The order timeline names what moved, not "0 bundles, 0.000 kg".
    await page.goto(`/orders/${target.id}`);
    await settled(page);
    await expect(
      page.locator("[data-timeline='order.reallocate']").filter({ hasText: new RegExp(`1 bundle, ${kg.replace(".", "\\.")} kg, (moved )?from KD Extrusion to Royal Aluminium ${target.number}`) }),
    ).toHaveCount(2);
    // The decision row says it moved; the request row says it was asked.
    await expect(
      page.locator("[data-timeline='order.reallocate']").filter({ hasText: `1 bundle, ${kg} kg, moved from KD Extrusion to Royal Aluminium ${target.number}` }),
    ).toHaveCount(1);
    await owner.context().close();
  });
});

test.describe("press plan", () => {
  test("a phone gets a note instead of the board", async ({ page }) => {
    await open(page, { role: "office", width: 375, path: "/orders/plan" });
    await expect(page.locator("[data-bigger-screen]")).toContainText("Use a bigger screen");
    await expect(page.getByRole("button", { name: "Save draft plan" })).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "plan-375");
  });

  test("the window opens on the plant's production day, not the browser's clock or zone (BACKLOG 51)", async ({ browser }) => {
    // A browser in New York whose clock reads three days ago at 03:17: the form must not use either.
    const context = await browser.newContext({ baseURL: ORIGIN, timezoneId: "America/New_York", viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const fake = new Date(Date.now() - 3 * 86_400_000);
    fake.setUTCHours(7, 17, 0, 0); // 03:17 in New York
    await page.clock.setFixedTime(fake);
    await open(page, { role: "office", width: 1280, path: "/orders" });
    const own = await apiConfirmed(page, "dev-customer-royal", [{ sectionId: "dev-die-14701", pcs: 6 }]);
    await page.goto("/orders/plan");
    await settled(page);
    const w = await trpcQuery<{ productionDay: string; startMs: number; endMs: number; timezone: string }>(page, "plans.defaultWindow", {});
    expect(w.timezone).toBe("Asia/Kolkata");
    // The plant's wall clock of the server's window (the seed's shifts open the day at 08:00).
    const wall = (ms: number) => {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", { timeZone: w.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
          .formatToParts(new Date(ms))
          .map((x) => [x.type, x.value]),
      );
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    };
    expect(wall(w.startMs)).toBe(`${w.productionDay}T08:00`);
    expect(w.endMs - w.startMs).toBe(24 * 3_600_000);
    await expect(page.getByLabel("Window starts")).toHaveValue(wall(w.startMs));
    await expect(page.getByLabel("Window ends")).toHaveValue(wall(w.endMs));
    await expect(page.locator("[data-plan-window]")).toContainText("today 08:00 to tomorrow 08:00, plant time");
    // The saved plan keeps exactly that window (the fields are read on the plant's clock too).
    await page.getByRole("textbox", { name: "Search open lines" }).fill(own.po);
    await page.locator(`[data-candidate='${own.number}']`).getByRole("button", { name: "Add" }).click();
    await pickPress(page);
    await page.getByRole("button", { name: "Save draft plan" }).click();
    await expect(page).toHaveURL(/\/orders\/plan\/[^/]+$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    const plan = await trpcQuery<{ plan: { windowStart: string | number; windowEnd: string | number } }>(page, "plans.get", { id });
    expect(new Date(plan.plan.windowStart).getTime()).toBe(w.startMs);
    expect(new Date(plan.plan.windowEnd).getTime()).toBe(w.endMs);
    await trpcMutation(page, "plans.cancel", { id, reason: "e2e: window check only" });
    await trpcMutation(page, "orders.close", { id: own.id, reason: "e2e: window check only" });
    await context.close();
  });

  test("draft a plan from the open lines and release it: one queued run per die", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { role: "office", width: 1280, path: "/orders" });
    // The seeded SO-2 is an open line on the board; the plan is drafted from an order of this test's
    // own (BACKLOG 42: no spec plans a seeded order line; press.spec plans orders of its own).
    const own = await apiConfirmed(page, "dev-customer-royal", [{ sectionId: "dev-die-14701", pcs: 12 }]);
    await page.goto("/orders/plan");
    await settled(page);
    await expect(page.getByRole("heading", { name: "Open lines", level: 3 })).toBeVisible();
    const seeded = page.locator("[data-candidate='SO-2']");
    await expect(seeded).toContainText("Royal Aluminium");
    await expect(seeded).toContainText("PO-118");
    await expect(seeded).toContainText(/kg to plan/);
    await page.getByRole("textbox", { name: "Search open lines" }).fill(own.po);
    const candidate = page.locator(`[data-candidate='${own.number}']`);
    await expect(candidate).toContainText("Royal Aluminium");
    await expect(candidate).toContainText(own.po);
    await expect(candidate).toContainText(/kg to plan/);
    await candidate.getByRole("button", { name: "Add" }).click();
    await expect(page.locator(`[data-candidate='${own.number}']`)).toHaveCount(0);
    await expect(page.locator("[data-draft-die]")).toHaveCount(1);
    // The seed has two presses since Wave 2 (P2 for die trials): the plan names its press.
    await expect(page.getByRole("button", { name: "Save draft plan" })).toBeDisabled();
    await pickPress(page);
    await expect(page.getByRole("button", { name: "Save draft plan" })).toBeEnabled();
    await expect(page.locator("[data-draft-footer]")).toHaveText(/1 die, \d+ lines?/);
    await shot(page, "plan-board-1280");

    // A window over 24 hours is refused before it is sent.
    const end = page.getByLabel("Window ends");
    const keep = await end.inputValue();
    await end.fill("2099-01-01T00:00");
    await expect(page.getByText("The window is longer than 24 hours.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save draft plan" })).toBeDisabled();
    await end.fill(keep);

    await page.getByRole("button", { name: "Save draft plan" }).click();
    await expect(page).toHaveURL(/\/orders\/plan\/[^/]+$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.locator("[data-plan-status='draft']")).toBeVisible();
    await page.getByRole("button", { name: "Release to press" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Release to press" }).click();
    await expect(page.locator("[data-plan-status='released']")).toBeVisible();
    await expect(page.locator("[data-run]")).toContainText(/PR-\d+ · Queued/);
    await shot(page, "plan-released-1280");

    const plan = await trpcQuery<{ plan: { status: string }; runs: { status: string; number: string }[]; dies: unknown[] }>(page, "plans.get", { id });
    expect(plan.plan.status).toBe("released");
    expect(plan.dies).toHaveLength(1);
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]).toMatchObject({ status: "queued" });
    expect(plan.runs[0]!.number).toMatch(/^PR-\d+/);
  });

  test("other open lines on the draft's dies, add all of an SO, the die count, and editing a draft (rank 30, I-2, I-3, I-6)", async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, { role: "office", width: 1280, path: "/orders" });
    const a = await apiConfirmed(page, "dev-customer-royal", [
      { sectionId: "dev-die-14701", pcs: 20 },
      { sectionId: "dev-die-14715", pcs: 8 },
    ]);
    const b = await apiConfirmed(page, "dev-customer-kd", [{ sectionId: "dev-die-14701", pcs: 6 }]);

    await page.goto("/orders/plan");
    await settled(page);
    await page.getByRole("textbox", { name: "Search open lines" }).fill(a.po);
    await page.locator(`[data-add-all='${a.number}']`).first().click();
    await expect(page.locator("[data-draft-die]")).toHaveCount(2);
    await expect(page.locator("[data-draft-footer]")).toHaveText("2 dies, 2 lines");

    // The other open lines on those dies, from the server: KD's line on 14701 with SO, PO, length, kg and pcs.
    const other = page.locator(`[data-other-line='${b.number}']`);
    await expect(other).toContainText("KD Extrusion");
    await expect(other).toContainText(b.po);
    await expect(other).toContainText("12 ft");
    await expect(other).toContainText(/kg, 6 pcs to plan/);
    await other.getByRole("button", { name: "Add" }).click();
    await expect(page.locator("[data-draft-footer]")).toHaveText("2 dies, 3 lines");
    await expect(page.locator(`[data-draft-line='${b.number}']`)).toBeVisible();
    await page.locator(`[data-draft-line='${b.number}']`).getByRole("button", { name: "Remove" }).click();
    await expect(page.locator("[data-draft-footer]")).toHaveText("2 dies, 2 lines");
    await pickPress(page);
    await expect(page.getByRole("button", { name: "Save draft plan" })).toBeEnabled();
    expect(await blockingAxeViolations(page), "/orders/plan at 1280").toEqual([]);
    await shot(page, "plan-board-other-1280");
    await page.getByRole("button", { name: "Save draft plan" }).click();
    await expect(page).toHaveURL(/\/orders\/plan\/[^/]+$/);
    const id = new URL(page.url()).pathname.split("/").pop()!;
    await expect(page.locator("[data-plan-status='draft']")).toBeVisible();

    // On the draft's page: add KD's line in one tap, then take it off again.
    const panel = page.locator("[data-other-lines]");
    await panel.locator(`[data-other-line='${b.number}']`).getByRole("button", { name: "Add" }).click();
    await expect(toast(page, "Added to the plan")).toBeVisible();
    await expect(page.locator(`[data-plan-line='${b.number}']`)).toBeVisible();
    await page.locator(`[data-plan-line='${b.number}']`).getByRole("button", { name: "Remove" }).click();
    await expect(toast(page, "Taken off the plan")).toBeVisible();
    await expect(page.locator(`[data-plan-line='${b.number}']`)).toHaveCount(0);

    // I-3: the list shows this plan's own dies and kg.
    const got = await trpcQuery<{ plan: { number: string }; lines: { kgG: number }[] }>(page, "plans.get", { id });
    const kgG = got.lines.reduce((sum, l) => sum + l.kgG, 0);
    expect(got.lines).toHaveLength(2);
    await page.goto("/orders/plan");
    await settled(page);
    await expect(page.locator(`[data-plan='${got.plan.number}']`)).toContainText(`2 dies, ${kg3(kgG)} kg`);

    // Release: KD's line is a warning with its SO number, length and party.
    await page.goto(`/orders/plan/${id}`);
    await settled(page);
    await page.getByRole("button", { name: "Release to press" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Release to press" }).click();
    await expect(page.locator("[data-plan-status='released']")).toBeVisible();
    const warning = page.locator(`[data-plan-warning='${b.number}']`);
    await expect(warning).toContainText(`14701 is also open for KD Extrusion on ${b.number} (12 ft)`);
    await expect(page.locator("[data-other-lines]")).toHaveCount(0);
  });

  test("the board works on a tablet", async ({ page }) => {
    await open(page, { role: "office", width: 820, path: "/orders/plan" });
    await settled(page);
    await expect(page.getByRole("heading", { name: "Open lines", level: 3 })).toBeVisible();
    await expect(page.locator("[data-bigger-screen]")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "plan-820");
  });
});

test.describe("edit lines (review I-1)", () => {
  test("a confirmed order's pieces change and a line goes; a line on a released plan keeps its figures", async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, { role: "office", width: 1280, path: "/orders" });
    const made = await apiConfirmed(page, "dev-customer-royal", [
      { sectionId: "dev-die-14701", pcs: 10 },
      { sectionId: "dev-die-14715", pcs: 5 },
    ]);
    await page.goto(`/orders/${made.id}`);
    await settled(page);
    await page.getByRole("button", { name: "Edit lines" }).click();
    const editor = page.locator("[data-lines-editor]");
    await expect(editor.locator("[data-line]")).toHaveCount(2);
    const line1 = editor.locator("[data-line='1']");
    await expect(line1.getByRole("textbox", { name: "Pieces" })).toHaveValue("10");
    await line1.getByRole("textbox", { name: "Pieces" }).fill("12");
    // Quoted on the line's own locked basis (`lineId`), as the save keeps it.
    const stored = await trpcQuery<{ lineDetails: { weightBasis: string }[] }>(page, "orders.get", { id: made.id });
    const quote = await trpcQuery<{ kgG: number; locked: boolean }>(page, "orders.quote", {
      lineId: made.lines[0]!.lineId,
      sectionId: "dev-die-14701",
      cutLengthMm: 3658,
      qtyBasis: "pcs",
      pcs: 12,
      weightBasis: stored.lineDetails[0]!.weightBasis,
      dieInstanceId: null,
    });
    expect(quote.locked).toBe(true);
    await expect(line1.locator("[data-quote]")).toContainText(`12 pcs come to ${kg3(quote.kgG)} kg`);
    await expect(line1.locator("[data-quote]")).toContainText("locked when this line was booked");
    await editor.locator("[data-line='2']").getByRole("button", { name: "Remove" }).click();
    await shot(page, "edit-lines-1280");
    await editor.getByRole("button", { name: "Save lines" }).click();
    await expect(toast(page, "Lines saved")).toBeVisible();
    await expect(page.locator("[data-lines-editor]")).toHaveCount(0);

    const after = await trpcQuery<GotOrder>(page, "orders.get", { id: made.id });
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]).toMatchObject({ lineId: made.lines[0]!.lineId, orderedPcs: 12, orderedG: quote.kgG });
    await expect(page.locator("[data-order-line='1'] [data-strip='orderedG']")).toContainText(`${kg3(quote.kgG)} kg`);
    await expect(page.locator("[data-order-line='1'] [data-strip='orderedG']")).toContainText("12 pcs");

    // Released to the press: its figures are fixed, and the refusal reads as a sentence.
    const now = Date.now();
    const plan = await trpcMutation<{ id: string }>(page, "plans.create", {
      windowStart: now,
      windowEnd: now + 3_600_000,
      pressLineId: "dev-press-line-1",
      dies: [{ sectionId: "dev-die-14701", lines: [{ salesOrderLineId: made.lines[0]!.lineId, pcs: 2 }] }],
    });
    await trpcMutation(page, "plans.release", { id: plan.id });
    await page.reload();
    await settled(page);
    await page.getByRole("button", { name: "Edit lines" }).click();
    await page.locator("[data-lines-editor] [data-line='1']").getByRole("textbox", { name: "Pieces" }).fill("15");
    await expect(page.locator("[data-lines-editor] [data-line='1'] [data-quote]")).toContainText("15 pcs come to");
    await page.getByRole("button", { name: "Save lines" }).click();
    await expect(page.locator("[data-lines-error]")).toContainText(
      "Line 1 is on a released press plan. Its kg, pieces, length and die can't change now.",
    );
    expect((await trpcQuery<GotOrder>(page, "orders.get", { id: made.id })).lines[0]).toMatchObject({ orderedPcs: 12 });
  });
});

test.describe("take ready stock (review I-4)", () => {
  test("stock on no order goes on the line at once; another customer's waits for a manager", async ({ page }) => {
    test.setTimeout(150_000);
    await open(page, { role: "office", width: 375, path: "/orders" });
    const royal = await apiConfirmed(page, "dev-customer-royal", [{ sectionId: "dev-die-14715", pcs: 10 }]);
    await page.goto(`/orders/${royal.id}`);
    await settled(page);
    await page.locator("[data-take-stock='1']").click();
    const sheet = page.getByRole("dialog", { name: "Ready stock for line 1" });
    await expect(sheet).toBeVisible();
    // Stock on no order of die 14715 (the seed packs none of it for an order). SO-1's bundles (other
    // tests move them to plant stock) would still remember KD Extrusion, so they are never picked.
    const so1 = await trpcQuery<{ items: { serial: string }[] }>(page, "orders.lineBundles", { lineId: "dev-sol-1-1", limit: 50 });
    const fromKd = new Set(so1.items.map((b) => b.serial));
    const free = sheet.locator("[data-stock-group='plant'] [data-stock-bundle], [data-stock-group='unassigned'] [data-stock-bundle]");
    await expect(free.first()).toBeVisible();
    const serials = await free.evaluateAll((els) => els.map((e) => e.getAttribute("data-stock-bundle") ?? ""));
    const pick = serials.find((x) => !fromKd.has(x));
    expect(pick, "a bundle on no order").toBeTruthy();
    await expect(sheet.getByRole("button", { name: "Put on this line" })).toBeDisabled();
    await sheet.locator(`[data-stock-bundle='${pick}']`).getByRole("checkbox").click();
    await sheet.getByLabel("Reason", { exact: true }).selectOption("customer_request");
    await shot(page, "take-stock-375");
    await sheet.getByRole("button", { name: "Put on this line" }).click();
    await expect(sheet.locator("[data-take-result='applied']")).toContainText("1 bundle moved");
    await sheet.getByRole("button", { name: "Done" }).click();
    const bundles = await trpcQuery<{ items: { serial: string; movedAway: boolean }[] }>(page, "orders.lineBundles", {
      lineId: royal.lines[0]!.lineId,
      limit: 50,
    });
    const onLine = bundles.items.filter((b) => !b.movedAway);
    expect(onLine).toHaveLength(1);
    const strip = (await trpcQuery<{ lineDetails: { strip: { inStockG: number } }[] }>(page, "orders.get", { id: royal.id })).lineDetails[0]!.strip;
    expect(strip.inStockG).toBeGreaterThan(0);
    await expect(page.locator("[data-order-line='1'] [data-strip='inStockG']")).toContainText(`${kg3(strip.inStockG)} kg`);

    // Another customer's order takes that bundle: a request, nothing moves yet.
    const kd = await apiConfirmed(page, "dev-customer-kd", [{ sectionId: "dev-die-14715", pcs: 10 }]);
    await page.goto(`/orders/${kd.id}`);
    await settled(page);
    await page.locator("[data-take-stock='1']").click();
    const sheet2 = page.getByRole("dialog", { name: "Ready stock for line 1" });
    const theirs = sheet2.locator(`[data-stock-bundle='${onLine[0]!.serial}']`);
    await expect(theirs).toContainText("Needs a manager");
    await theirs.getByRole("checkbox").click();
    await sheet2.getByLabel("Reason", { exact: true }).selectOption("customer_request");
    await sheet2.getByRole("button", { name: "Put on this line" }).click();
    const result = sheet2.locator("[data-take-result='pending']");
    await expect(result).toContainText("Waiting for a manager");
    await expect(result.getByRole("link", { name: "See the request" })).toBeVisible();
    await sheet2.getByRole("button", { name: "Done" }).click();
    // The order that asked shows the request until a manager decides; the bundle stays where it was.
    await expect(page.locator("[data-pending-request]")).toContainText("Waiting for a manager");
    await expect(page.locator("[data-pending-request]")).toContainText(kd.number);
    const still = await trpcQuery<{ items: { movedAway: boolean }[] }>(page, "orders.lineBundles", { lineId: royal.lines[0]!.lineId, limit: 50 });
    expect(still.items.filter((b) => !b.movedAway)).toHaveLength(1);
  });
});

test.describe("close and cancel (review m-11)", () => {
  test("close asks why while baki is left; cancel always asks why", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { role: "office", width: 375, path: "/orders" });
    const toClose = await apiConfirmed(page, "dev-customer-royal", [{ sectionId: "dev-die-14701", pcs: 3 }]);
    await page.goto(`/orders/${toClose.id}`);
    await settled(page);
    await page.getByRole("button", { name: "Close order" }).click();
    const closeSheet = page.getByRole("dialog", { name: "Close order" });
    await expect(closeSheet).toContainText("kg is still to dispatch");
    await expect(closeSheet.getByRole("button", { name: "Close order" })).toBeDisabled();
    await closeSheet.getByRole("textbox").fill("Customer took the rest from another plant");
    await closeSheet.getByRole("button", { name: "Close order" }).click();
    await expect(toast(page, "Order closed")).toBeVisible();
    await expect(page.getByText("Closed", { exact: true }).first()).toBeVisible();

    const toCancel = await apiBooking(page, 3658, `E2E-C-${Date.now()}`);
    await page.goto(`/orders/${toCancel.id}`);
    await settled(page);
    await page.getByRole("button", { name: "Cancel order" }).click();
    const cancelSheet = page.getByRole("dialog", { name: "Cancel order" });
    await expect(cancelSheet.getByRole("button", { name: "Cancel order" })).toBeDisabled();
    await cancelSheet.getByRole("textbox").fill("Booked twice");
    await cancelSheet.getByRole("button", { name: "Cancel order" }).click();
    await expect(toast(page, "Order cancelled")).toBeVisible();
    const got = await trpcQuery<{ order: { status: string; cancelReason: string } }>(page, "orders.get", { id: toCancel.id });
    expect(got.order).toMatchObject({ status: "cancelled", cancelReason: "Booked twice" });
  });
});

test.describe("who sees what", () => {
  test("a viewer reads orders and sees no actions", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, { role: "viewer", width: 1280, path: "/orders" });
    await settled(page);
    await expect(page.locator("main#main").getByText("SO-1", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "New order" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Press plan" })).toHaveCount(0);

    await page.goto("/orders/dev-so-3");
    await settled(page);
    await expect(page.getByRole("heading", { name: "SO-3", level: 1 })).toBeVisible();
    for (const name of ["Confirm order", "Edit", "Edit lines", "Close order", "Cancel order", "Move bundles", "Take ready stock", "Refresh weight"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0);
    }
    await page.goto("/orders/dev-so-1");
    await settled(page);
    await expect(page.getByRole("button", { name: "Move bundles" })).toHaveCount(0);
    await expect(page.locator("[data-strip='orderedG']").first()).toContainText("kg");

    await page.goto("/orders/new");
    await expect(page.getByText("Your role can't do this. Ask an admin if you need it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Book order" })).toHaveCount(0);

    await page.goto("/orders/plan");
    await settled(page);
    await expect(page.getByRole("button", { name: "Save draft plan" })).toHaveCount(0);
  });

  test("the nav offers Orders to office and not to a viewer", async ({ browser }) => {
    const office = await newPage(browser);
    await open(office, { role: "office", width: 1280, path: "/today" });
    await expect(office.locator("[data-slot='app-shell']").getByRole("link", { name: "Orders" }).first()).toBeVisible();
    const viewer = await newPage(browser);
    await open(viewer, { role: "viewer", width: 1280, path: "/today" });
    await expect(viewer.locator("[data-slot='app-shell']").getByRole("link", { name: "Orders" })).toHaveCount(0);
  });
});

test.describe("Hindi", () => {
  test("list, detail, new order and plan read in Hindi at 375 without sideways scroll", async ({ page }) => {
    test.setTimeout(150_000);
    await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
    await open(page, { role: "office", width: 375, path: "/orders" });
    for (const path of ["/orders", "/orders/dev-so-1", "/orders/dev-so-3", "/orders/new", "/orders/plan"]) {
      await page.goto(path);
      await expect(page.locator("main#main h1").first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "hi");
      await settled(page);
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main#main");
      expect(await blockingAxeViolations(page), path).toEqual([]);
    }
    await page.goto("/orders");
    await expect(page.getByRole("heading", { name: "ऑर्डर", level: 1 })).toBeVisible();
    await shot(page, "list-hi-375");
    await page.goto("/orders/dev-so-3");
    await expect(page.locator("[data-confirm-checklist]")).toContainText("PO नंबर डालें।");
    await shot(page, "detail-hi-375");
    await page.goto("/orders/plan");
    await expect(page.locator("[data-bigger-screen]")).toContainText("बड़ी स्क्रीन");
  });
});
