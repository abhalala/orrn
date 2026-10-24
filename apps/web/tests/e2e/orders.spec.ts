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
      await expect(main.getByText("No PO yet")).toBeVisible();
      // Only SO-1 is past 15 days.
      await expect(main.getByText(/Late, \d+ days/)).toHaveCount(1);
      // Other tests in this file book and confirm orders of their own, so these are "at least".
      await expect(main.getByText("Booking", { exact: true }).first()).toBeVisible();
      await expect(main.getByText("Confirmed", { exact: true }).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main#main");
      await shot(page, `list-${width}`);

      // The segments filter on the server.
      await page.getByRole("radio", { name: "Closed" }).check();
      await expect(main.getByText("Nothing under Closed")).toBeVisible();
      await page.getByRole("radio", { name: "Open" }).check();
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
      for (const label of ["Ordered", "Planned", "Pressed", "Aged", "Packed", "In stock", "Dispatched", "Baki"]) {
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
    await page.getByRole("button", { name: "Edit" }).click();
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
    await expect(page.locator("[data-timeline='order.reallocate']").first()).toContainText("moved");
  });

  test("SO-1 bundles to another customer wait for a manager, with a length warning", async ({ page }) => {
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
    await expect(sheet.locator("[data-length-warning]")).toContainText("The cut length differs from this line's");
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

  test("draft a plan from the open lines and release it: one queued run per die", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { role: "office", width: 1280, path: "/orders/plan" });
    await settled(page);
    await expect(page.getByRole("heading", { name: "Open lines", level: 3 })).toBeVisible();
    const candidate = page.locator("[data-candidate='SO-2']");
    await expect(candidate).toContainText("Royal Aluminium");
    await expect(candidate).toContainText("PO-118");
    await expect(candidate).toContainText(/kg to plan/);
    await candidate.getByRole("button", { name: "Add" }).click();
    await expect(page.locator("[data-candidate='SO-2']")).toHaveCount(0);
    await expect(page.locator("[data-draft-die]")).toHaveCount(1);
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

  test("the board works on a tablet", async ({ page }) => {
    await open(page, { role: "office", width: 820, path: "/orders/plan" });
    await settled(page);
    await expect(page.getByRole("heading", { name: "Open lines", level: 3 })).toBeVisible();
    await expect(page.locator("[data-bigger-screen]")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await shot(page, "plan-820");
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
    for (const name of ["Confirm order", "Edit", "Close order", "Cancel order", "Move bundles"]) {
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
