import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Purchase and approvals (PL-W2): scrap lots, the new-lot stepper with the
 * live kanta difference and the inline debit note, the lot page with its next
 * step, and the shared approvals inbox. Key flow (plan PL-W2): a short lot,
 * its D/C note, a manager's approval, the lot marked OK and scrap stock up.
 *
 * Seed roles: office raises lots and D/C notes (purchase.receipt +
 * purchase.dcnote), owner approves (approver for dc_note, never their own
 * request), operator weighs at the kanta but can't raise notes.
 */

const SHOTS = process.env.PLW2_SHOTS_DIR;

type Scheme = "light" | "dark";

async function open(page: Page, opts: { role: LocalRole; width: number; path: string; scheme?: Scheme; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role);
  await page.goto(opts.path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

/**
 * The screen has finished loading: no skeleton or busy region left in main. (Not "networkidle":
 * the shell keeps polling, so the network never goes quiet.)
 */
async function settled(page: Page) {
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
}

/** A lot number as a whole code: "LOT-11" must not match "LOT-110". */
function wholeCode(code: string) {
  return new RegExp(`${code.replace(/[-]/g, "\\-")}(?!\\d)`);
}

/**
 * Chips that must read in full (`data-no-truncate`) fit inside their own pill. The shared guard
 * checks ellipses and clipping boxes, not a nowrap chip whose words spill past its edge.
 */
async function expectFullChipsFit(page: Page) {
  const spills = await page.locator("main#main [data-slot='chip'][data-no-truncate]").evaluateAll((chips) =>
    chips
      .filter((c) => c.getBoundingClientRect().width > 0 && c.scrollWidth > c.clientWidth + 1)
      .map((c) => `${c.textContent?.trim()} (${c.scrollWidth} > ${c.clientWidth})`),
  );
  expect(spills).toEqual([]);
}

/** A sonner toast with this text (the screen's own words, like the "Rejected" filter, don't count). */
function toast(page: Page, text: string) {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({ baseURL: ORIGIN });
  return context.newPage();
}

async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page
    .context()
    .request.get(`${API}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
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

/** A lot made over the API (as office), for screens that need one in a known state. */
async function apiLot(page: Page, weights: { partyKg: number; fcKg: number | null }) {
  const [vendors, items] = await Promise.all([
    trpcQuery<{ items: { id: string; name: string }[] }>(page, "vendor.list", { q: "K.D. Metals", limit: 1 }),
    trpcQuery<{ items: { id: string; name: string }[] }>(page, "purchase.scrapItems.list", undefined),
  ]);
  return trpcMutation<{ id: string; number: string }>(page, "purchase.lots.create", {
    vendorId: vendors.items[0]!.id,
    itemId: items.items.find((i) => i.name === "SOFT CABLE")!.id,
    grade: "B",
    partyKgG: weights.partyKg * 1000,
    fcKgG: weights.fcKg === null ? null : weights.fcKg * 1000,
    ratePaise: 20_150,
    billBook: "main",
    vehicleNo: "GJ03E2E0001",
  });
}

/**
 * Scrap stock of one item and grade, in grams. Other tests in this file mark SOFT CABLE lots OK
 * in parallel workers, so the key flow (IMP BELLING, grade A, made only there) reads its own row.
 */
async function scrapStockG(page: Page, item: string, grade: string) {
  const stock = await trpcQuery<{ items: { itemName: string | null; gradeCode: string | null; qtyG: number }[] }>(
    page,
    "purchase.scrapStock",
    undefined,
  );
  return stock.items.filter((r) => r.itemName === item && r.gradeCode === grade).reduce((sum, r) => sum + r.qtyG, 0);
}

/** Fill the first two steps of the new-lot stepper and land on Weights. */
async function toWeightsStep(page: Page) {
  await page.getByRole("combobox", { name: "Vendor" }).fill("K.D");
  await page.getByRole("option", { name: /K\.D\. Metals/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("radio", { name: "IMP BELLING" }).check();
  await page.getByRole("radio", { name: "A", exact: true }).check();
  await page.getByLabel("Rate (₹ per kg)").fill("200");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Weights", level: 2 })).toBeFocused();
}

test.describe("purchase and approvals", () => {
  test("short lot -> D/C note -> manager approves -> lot OK -> scrap stock up", async ({ browser }) => {
    // Two people, several screens and server round trips: more than the default 30 s under load.
    test.setTimeout(120_000);
    const office = await newPage(browser);
    await open(office, { role: "office", width: 390, path: "/purchase/new" });
    const before = await scrapStockG(office, "IMP BELLING", "A");

    await toWeightsStep(office);
    await office.getByLabel("Party kanta (kg)").fill("1000");
    await office.getByLabel("Our kanta (kg)").fill("980");
    const diff = office.getByTestId("kanta-difference");
    await expect(diff).toHaveAttribute("data-state", "short");
    await expect(diff).toContainText("Short, beyond 0.5%");
    await expect(diff).toContainText("Tolerance 5 kg (0.5%)");
    // The debit note is raised in the same save, starting at the whole short.
    await expect(office.getByRole("checkbox", { name: "Raise the debit note now" })).toBeChecked();
    await expect(office.getByLabel("Kg to debit")).toHaveValue("20");
    await office.getByRole("button", { name: "Next" }).click();

    await office.getByLabel(/Vehicle number/).fill("gj03 ab 7788");
    await office.getByRole("button", { name: "Save lot" }).click();
    await expect(office).toHaveURL(/\/purchase\/[\w-]+$/);
    await expect(office.getByText(/Note .+ sent for approval/)).toBeVisible();
    await expect(office.getByTestId("kanta-hero")).toBeVisible();
    const lotUrl = office.url();
    const lotNumber = (await office.locator("main#main h1").first().textContent())!.trim();

    // The pending note covers the short, so the lot may go OK; it stays visible as Waiting.
    await expect(office.getByTestId("kanta-hero")).toContainText("20");
    await expect(office.getByText("The debit notes cover the short. The lot can go OK.")).toBeVisible();
    await expect(office.getByRole("region", { name: "Debit and credit notes" })).toContainText("Waiting");

    // The requester can't approve their own note.
    await office.goto("/approvals");
    const ownCard = office.getByTestId("approval-card").filter({ hasText: lotNumber });
    await expect(ownCard).toContainText("Someone else has to approve your request.");

    // The owner approves from the inbox.
    const owner = await newPage(browser);
    await open(owner, { role: "owner", width: 1280, path: "/approvals" });
    await expect(owner.getByText("Waiting for a decision")).toBeVisible();
    const card = owner.getByTestId("approval-card").filter({ hasText: lotNumber });
    await card.getByRole("button", { name: /^Review/ }).click();
    const sheet = owner.getByRole("dialog");
    await expect(sheet).toContainText("Party kanta");
    await expect(sheet).toContainText("1,000 kg");
    await expect(sheet).toContainText("Covers the short beyond 0.5%");
    await expect(await blockingAxeViolations(owner)).toEqual([]);
    await sheet.getByRole("button", { name: "Approve" }).click();
    await expect(toast(owner, "Approved")).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(owner.getByTestId("approval-card").filter({ hasText: lotNumber })).toHaveCount(0);

    // Back at the kanta: mark OK, scrap stock goes up by our kanta weight (no bori).
    await office.goto(lotUrl);
    await expect(office.getByRole("region", { name: "Debit and credit notes" })).toContainText("Approved");
    const markOk = office.getByRole("button", { name: "Mark OK" }).locator("visible=true").first();
    await markOk.click();
    await expect(office.getByText(/Marked OK\. 980 kg in scrap stock at /)).toBeVisible();
    await expect(office.getByTestId("kanta-hero")).toHaveAttribute("data-tone", "green");
    await expect(office.getByText(/980 kg in at /)).toBeVisible();
    expect(await scrapStockG(office, "IMP BELLING", "A")).toBe(before + 980_000);
  });

  test("a short lot without a covering note can't be marked OK, and the yard is told who raises it", async ({ page }) => {
    await open(page, { role: "operator", width: 390, path: "/purchase" });
    const lot = await apiLot(page, { partyKg: 2000, fcKg: 1900 });
    await page.goto(`/purchase/${lot.id}`);
    await expect(page.getByText(/100 kg short, beyond 0\.5%/)).toBeVisible();
    await expect(page.getByText(/Ask the office to raise a debit note for at least 90 kg\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark OK" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Raise D/C note" })).toHaveCount(0);
  });

  test("office raises the note from the lot page; reject needs a reason", async ({ browser }) => {
    // Two people, several screens and server round trips: more than the default 30 s under load.
    test.setTimeout(120_000);
    const office = await newPage(browser);
    await open(office, { role: "office", width: 1280, path: "/purchase" });
    const lot = await apiLot(office, { partyKg: 3000, fcKg: 2950 });
    await office.goto(`/purchase/${lot.id}`);
    await office.getByRole("button", { name: "Raise D/C note" }).locator("visible=true").first().click();
    const sheet = office.getByRole("dialog", { name: "Raise D/C note" });
    await expect(sheet.getByLabel("Kg difference")).toHaveValue("50");
    await sheet.getByLabel("Kg difference").fill("10");
    await sheet.getByRole("button", { name: "Send for approval" }).click();
    await expect(sheet.getByText("The note must cover at least the short beyond the tolerance.")).toBeVisible();
    await sheet.getByLabel("Kg difference").fill("50");
    await sheet.getByRole("button", { name: "Send for approval" }).click();
    await expect(office.getByText(/Note .+ sent for approval/)).toBeVisible();

    const owner = await newPage(browser);
    await open(owner, { role: "owner", width: 390, path: "/approvals" });
    const card = owner.getByTestId("approval-card").filter({ hasText: wholeCode(lot.number) });
    await card.getByRole("button", { name: /^Review/ }).click();
    const review = owner.getByRole("dialog");
    await review.getByRole("button", { name: "Reject" }).click();
    await expect(review.getByText("Write why you are rejecting it.")).toBeVisible();
    await review.getByLabel("Note").fill("Weigh it again on our kanta");
    await review.getByRole("button", { name: "Reject" }).click();
    await expect(toast(owner, "Rejected")).toBeVisible();
    await expect(review).toBeHidden();
    await owner.goto("/approvals?status=rejected");
    await expect(owner.getByTestId("approval-card").filter({ hasText: wholeCode(lot.number) })).toContainText("Weigh it again on our kanta");
  });

  test("weights typed key by key: the note is the whole short, the summary shows it, and the saved note debits exactly that", async ({ page }) => {
    // Review round 1: a note latched on the first key of our kanta debited 991 kg for a 20 kg short.
    test.setTimeout(120_000);
    await open(page, { role: "office", width: 390, path: "/purchase/new" });
    await toWeightsStep(page);
    await page.getByLabel("Party kanta (kg)").pressSequentially("1000");
    await page.getByLabel("Our kanta (kg)").pressSequentially("980");
    await expect(page.getByTestId("kanta-difference")).toHaveAttribute("data-state", "short");
    await expect(page.getByLabel("Kg to debit")).toHaveValue("20");
    // A slip correction at the kanta (990, not 980): the note follows the new short.
    await page.getByLabel("Our kanta (kg)").press("Backspace");
    await page.getByLabel("Our kanta (kg)").press("Backspace");
    await page.getByLabel("Our kanta (kg)").pressSequentially("90");
    await expect(page.getByLabel("Kg to debit")).toHaveValue("10");
    // Above the short is refused, with focus on the field to fix.
    await page.getByLabel("Kg to debit").fill("900");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("A weight debit can't be more than the short. Lower the kg.")).toBeVisible();
    await expect(page.getByLabel("Kg to debit")).toBeFocused();
    await page.getByLabel("Kg to debit").fill("10");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Book", level: 2 })).toBeFocused();
    // Last look before Save: the note's kg is in the summary.
    const summary = page.locator("section").filter({ has: page.getByRole("heading", { name: "This lot" }) }).first();
    await expect(summary).toContainText("Debit note");
    await expect(summary).toContainText("10 kg");
    // The rate reads like the lot page: "Rate  ₹200.00 per kg", not the input's "Rate (₹ per kg)  ₹200.00".
    await expect(summary).toContainText("₹200.00 per kg");
    await expect(summary).not.toContainText("Rate (₹ per kg)");
    await page.getByRole("button", { name: "Save lot" }).click();
    await expect(page).toHaveURL(/\/purchase\/(?!new)[\w-]+$/);
    await expect(page.getByRole("region", { name: "Debit and credit notes" })).toContainText("10 kg");
  });

  test("the yard walks past the weights step after a correction makes the lot shorter", async ({ page }) => {
    // Review round 1: a hidden note check (fields only the office sees) froze Next for the operator.
    await open(page, { role: "operator", width: 390, path: "/purchase/new" });
    await toWeightsStep(page);
    await page.getByLabel("Party kanta (kg)").pressSequentially("10000");
    await page.getByLabel("Our kanta (kg)").pressSequentially("9940");
    for (let i = 0; i < 3; i++) await page.getByLabel("Our kanta (kg)").press("Backspace");
    await page.getByLabel("Our kanta (kg)").pressSequentially("000");
    await expect(page.getByTestId("kanta-difference")).toContainText("1,000");
    await expect(page.getByText("The office raises the debit note before this lot can go OK.")).toBeVisible();
    await expect(page.getByLabel("Kg to debit")).toHaveCount(0);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { name: "Book", level: 2 })).toBeFocused();
  });

  test("an OK lot whose covering note is rejected says so in red, and the list flags it", async ({ browser }) => {
    test.setTimeout(120_000);
    const office = await newPage(browser);
    await open(office, { role: "office", width: 1280, path: "/purchase" });
    const lot = await apiLot(office, { partyKg: 2000, fcKg: 1900 });
    const note = await trpcMutation<{ approvalId: string; number: string }>(office, "purchase.dcNotes.create", {
      lotId: lot.id,
      type: "debit",
      reason: "weight",
      kgDiffG: 100_000,
      boriDeductionG: 0,
    });
    // The pending note covers the short, so the lot goes OK before anyone decides.
    await trpcMutation(office, "purchase.lots.advance", { id: lot.id, to: "ok" });
    const owner = await newPage(browser);
    await open(owner, { role: "owner", width: 1280, path: "/approvals" });
    await trpcMutation(owner, "approval.decide", { id: note.approvalId, decision: "rejected", note: "Weigh again" });

    await office.goto(`/purchase/${lot.id}`);
    await expect(office.getByTestId("kanta-hero")).toHaveAttribute("data-tone", "green");
    const message = office.getByTestId("lot-message");
    await expect(message).toHaveAttribute("data-tone", "warn");
    await expect(message).toContainText("In stock, but 100 kg short, beyond 0.5%, and no live debit note covers it. Raise one for at least 90 kg.");
    // Raising the note is now the office's main step.
    await expect(office.getByRole("button", { name: "Raise D/C note" }).locator("visible=true")).toHaveCount(1);

    // The yard sees the same red message, worded for someone who doesn't raise notes, and nothing to press for it.
    const operator = await newPage(browser);
    await open(operator, { role: "operator", width: 390, path: `/purchase/${lot.id}` });
    await expect(operator.getByTestId("lot-message")).toContainText("Ask the office to raise one for at least 90 kg.");
    await expect(operator.getByRole("button", { name: "Raise D/C note" })).toHaveCount(0);

    // The list names it with a chip; the difference words stay quiet.
    await office.goto("/purchase?status=ok");
    // By the exact lot cell: a row's text runs "LOT-1" into "19 Sept", which a plain hasText "LOT-11" also matches.
    const row = office.getByRole("row").filter({ has: office.getByText(lot.number, { exact: true }) });
    // The flag comes from a second read (the register), so it may land after the row.
    await expect(row).toContainText("Needs a note", { timeout: 15_000 });
    // On a phone card the flag reads in full (it was cut to "Short, needs no..." at 375).
    await office.setViewportSize({ width: 375, height: 900 });
    await office.goto("/purchase?status=ok");
    await expect(office.locator("main#main [data-slot='chip']").filter({ hasText: "Needs a note" }).first()).toBeVisible({ timeout: 15_000 });
    await settled(office);
    await expectNoClippedText(office, "main#main");
    await expectFullChipsFit(office);
  });

  test("the approver is warned when a note is bigger than the short", async ({ browser }) => {
    test.setTimeout(120_000);
    const office = await newPage(browser);
    await open(office, { role: "office", width: 390, path: "/purchase" });
    const lot = await apiLot(office, { partyKg: 10_000, fcKg: 9_800 });
    await trpcMutation(office, "purchase.dcNotes.create", {
      lotId: lot.id,
      type: "debit",
      reason: "weight",
      kgDiffG: 9_991_000,
      boriDeductionG: 0,
    });
    const owner = await newPage(browser);
    await open(owner, { role: "owner", width: 390, path: "/approvals" });
    await owner.getByTestId("approval-card").filter({ hasText: wholeCode(lot.number) }).getByRole("button", { name: /^Review/ }).click();
    const sheet = owner.getByRole("dialog");
    await expect(sheet.getByTestId("note-over-short")).toContainText("This note is 9,791 kg more than the short. Check it before approving.");
    await expect(sheet).not.toContainText("Covers the short");
    await expect(await blockingAxeViolations(owner)).toEqual([]);
  });

  test("mark unloading, then cancel the lot with a reason", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, { role: "office", width: 390, path: "/purchase" });
    const lot = await apiLot(page, { partyKg: 4000, fcKg: null });
    await page.goto(`/purchase/${lot.id}`);
    // Not weighed yet is the normal next step: said plainly, not as an alarm.
    await expect(page.getByTestId("lot-message")).toHaveAttribute("data-tone", "info");
    await page.getByRole("button", { name: "Mark unloading" }).click();
    await expect(toast(page, "Marked unloading")).toBeVisible();
    await expect(page.getByTestId("kanta-hero")).toHaveAttribute("data-tone", "amber");
    await page.getByRole("button", { name: "Cancel lot" }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel this lot?" });
    await dialog.getByRole("button", { name: "Cancel lot" }).click();
    await expect(dialog.getByText("Write why the lot is cancelled.")).toBeVisible();
    await dialog.getByLabel("Reason").fill("Party sent the wrong truck");
    await dialog.getByRole("button", { name: "Cancel lot" }).click();
    await expect(toast(page, "Lot cancelled")).toBeVisible();
    await expect(page.getByTestId("kanta-hero")).toHaveAttribute("data-tone", "red");
    await expect(page.getByText("Cancelled: Party sent the wrong truck")).toBeVisible();
  });

  test("Hindi: layout guards on the four screens and the URL filters", async ({ page }) => {
    // Devanagari strings run longer; the floor works in Hindi.
    test.setTimeout(240_000);
    await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
    await open(page, { role: "office", width: 375, path: "/purchase" });
    const lot = await apiLot(page, { partyKg: 6540, fcKg: 6320 });
    for (const width of [375, 820, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/purchase?status=booking", "/purchase/new", `/purchase/${lot.id}`, "/approvals?status=rejected&kind=dc_note"]) {
        await page.goto(path);
        await expect(page.locator("main#main h1").first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("lang", "hi");
        await settled(page);
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page, "main#main");
        await expectFullChipsFit(page);
      }
    }
    // The URL filters land on their segment.
    await page.goto("/purchase?status=booking");
    await expect(page.getByRole("radio", { name: "बुक हुए" })).toBeChecked();
    await page.goto("/approvals?status=rejected&kind=dc_note");
    await expect(page.getByRole("radio", { name: /नामंज़ूर|रिजेक्ट/ })).toBeChecked();
    // The weights step with the inline note open, in Hindi at phone width.
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto("/purchase/new");
    await page.getByRole("combobox").first().fill("K.D");
    await page.getByRole("option", { name: /K\.D\. Metals/ }).click();
    await page.locator("form button[type=submit]").click();
    await page.getByRole("radio", { name: "IMP BELLING" }).check();
    await page.getByRole("radio", { name: "A", exact: true }).check();
    await page.locator("form input[inputmode=decimal]").first().fill("200");
    await page.locator("form button[type=submit]").click();
    const weights = page.locator("form input[inputmode=decimal]");
    await weights.nth(0).pressSequentially("6540");
    await weights.nth(1).pressSequentially("6320");
    await expect(page.getByTestId("kanta-difference")).toHaveAttribute("data-state", "short");
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, "main#main");
  });

  test("charts only for analytics roles", async ({ browser }) => {
    // Two people, several screens and server round trips: more than the default 30 s under load.
    test.setTimeout(120_000);
    const owner = await newPage(browser);
    await open(owner, { role: "owner", width: 1280, path: "/purchase" });
    await expect(owner.getByTestId("purchase-chart-rate")).toBeVisible();
    await expect(owner.getByTestId("purchase-chart-vendors")).toContainText("K.D. Metals");

    const operator = await newPage(browser);
    await open(operator, { role: "operator", width: 1280, path: "/purchase" });
    await expect(operator.getByRole("heading", { name: "Purchase", level: 1 })).toBeVisible();
    await expect(operator.getByRole("table", { name: "Scrap lots" })).toBeVisible();
    await expect(operator.getByTestId("purchase-chart-rate")).toHaveCount(0);
  });

  for (const width of [375, 390, 820, 1280, 1440]) {
    test(`layout guards and axe at ${width}`, async ({ page }) => {
      // Four screens in two themes, axe on two widths, then the weights step: well past the default 30 s.
      test.setTimeout(240_000);
      await open(page, { role: "office", width, path: "/purchase" });
      const lot = await apiLot(page, { partyKg: 6540, fcKg: 6320 });
      const paths = ["/purchase", "/purchase/new", `/purchase/${lot.id}`, "/approvals"];
      for (const path of paths) {
        for (const scheme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
          await page.goto(path);
          await expect(page.locator("main#main h1").first()).toBeVisible();
          await settled(page);
          await expectNoHorizontalScroll(page);
          await expectNoClippedText(page, "main#main");
          await expectFullChipsFit(page);
          if (width === 390 || width === 1280) {
            expect(await blockingAxeViolations(page), `${path} ${scheme}`).toEqual([]);
          }
        }
      }
      // The weights step with a short lot and the inline note open.
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await page.goto("/purchase/new");
      await toWeightsStep(page);
      await page.getByLabel("Party kanta (kg)").fill("6540");
      await page.getByLabel("Our kanta (kg)").fill("6320");
      await expect(page.getByTestId("kanta-difference")).toHaveAttribute("data-state", "short");
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page, "main#main");
      if (width === 390 || width === 1280) expect(await blockingAxeViolations(page)).toEqual([]);
    });
  }

  test("keyboard: the stepper moves focus to each step heading and Enter submits a step", async ({ page }) => {
    await open(page, { role: "office", width: 1280, path: "/purchase/new" });
    await page.getByRole("combobox", { name: "Vendor" }).fill("Ganesh");
    // Results are debounced: wait for them before choosing with the keyboard.
    await expect(page.getByRole("option", { name: /Ganesh/ })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    // Enter on Next.
    await page.getByRole("button", { name: "Next" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Material", level: 2 })).toBeFocused();
    // Arrow keys move through the material radios.
    await page.getByRole("radio", { name: "IMP BELLING" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "SOFT CABLE" })).toBeChecked();
  });

  test("screenshots for review", async ({ browser }) => {
    test.skip(!SHOTS, "set PLW2_SHOTS_DIR to capture screenshots");
    test.setTimeout(300_000);
    const office = await newPage(browser);
    await open(office, { role: "office", width: 1280, path: "/purchase" });
    const shortLot = await apiLot(office, { partyKg: 6540, fcKg: 6320 });
    const okLot = await apiLot(office, { partyKg: 8200, fcKg: 8185 });
    await trpcMutation(office, "purchase.lots.advance", { id: okLot.id, to: "ok" });
    await trpcMutation(office, "purchase.dcNotes.create", {
      lotId: shortLot.id,
      type: "debit",
      reason: "weight",
      kgDiffG: 220_000,
      boriDeductionG: 12_000,
      note: "25 bori on the truck",
    });
    // In stock, then its covering note rejected: the red "no live debit note" state.
    const uncoveredLot = await apiLot(office, { partyKg: 2000, fcKg: 1900 });
    const uncoveredNote = await trpcMutation<{ approvalId: string }>(office, "purchase.dcNotes.create", {
      lotId: uncoveredLot.id,
      type: "debit",
      reason: "weight",
      kgDiffG: 100_000,
      boriDeductionG: 0,
    });
    await trpcMutation(office, "purchase.lots.advance", { id: uncoveredLot.id, to: "ok" });
    const owner = await newPage(browser);
    await open(owner, { role: "owner", width: 1280, path: "/purchase" });
    await trpcMutation(owner, "approval.decide", { id: uncoveredNote.approvalId, decision: "rejected", note: "Weigh again" });
    for (const width of [375, 1280]) {
      for (const scheme of ["light", "dark"] as const) {
        await owner.setViewportSize({ width, height: 900 });
        await owner.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const shot = async (name: string) => {
          await expect(owner.locator("main#main h1").first()).toBeVisible();
          await settled(owner);
          // Let sheets and toasts finish moving (finite animations only; a skeleton pulse never ends).
          await owner.evaluate(() =>
            Promise.all(
              document
                .getAnimations()
                .filter((a) => a.effect?.getTiming().iterations !== Infinity)
                .map((a) => a.finished.catch(() => undefined)),
            ),
          );
          await owner.screenshot({ path: `${SHOTS}/${name}-${width}-${scheme}.png`, fullPage: true });
        };
        await owner.goto("/purchase");
        await expect(owner.getByRole("table", { name: "Scrap lots" }).or(owner.getByRole("list", { name: "Scrap lots" }))).toBeVisible();
        await shot("purchase-list");
        await owner.goto(`/purchase/${shortLot.id}`);
        await expect(owner.getByTestId("kanta-hero")).toBeVisible();
        await shot("lot-short");
        await owner.goto(`/purchase/${okLot.id}`);
        await expect(owner.getByTestId("kanta-hero")).toHaveAttribute("data-tone", "green");
        await shot("lot-ok");
        await owner.goto(`/purchase/${uncoveredLot.id}`);
        await expect(owner.getByTestId("lot-message")).toHaveAttribute("data-tone", "warn");
        await shot("lot-ok-uncovered");
        await owner.goto("/approvals");
        await expect(owner.getByTestId("approval-card").first()).toBeVisible();
        await shot("approvals");
        await owner.getByTestId("approval-card").filter({ hasText: wholeCode(shortLot.number) }).getByRole("button", { name: /^Review/ }).click();
        await expect(owner.getByRole("dialog")).toContainText("Party kanta");
        await shot("approval-review");
        await owner.keyboard.press("Escape");
        await owner.goto("/purchase/new");
        await toWeightsStep(owner);
        await owner.getByLabel("Party kanta (kg)").fill("6540");
        await owner.getByLabel("Our kanta (kg)").fill("6320");
        await expect(owner.getByTestId("kanta-difference")).toHaveAttribute("data-state", "short");
        await shot("new-lot-weights");
        await owner.getByRole("button", { name: "Next" }).click();
        await expect(owner.getByRole("heading", { name: "Book", level: 2 })).toBeFocused();
        await shot("new-lot-book");
        await owner.goto("/purchase/new");
        await shot("new-lot-vendor");
        await owner.getByRole("combobox", { name: "Vendor" }).fill("K.D");
        await owner.getByRole("option", { name: /K\.D\. Metals/ }).click();
        await owner.getByRole("button", { name: "Next" }).click();
        await owner.getByRole("radio", { name: "IMP BELLING" }).check();
        await shot("new-lot-material");
      }
    }
  });
});
