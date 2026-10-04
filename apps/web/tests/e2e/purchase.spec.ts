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

async function scrapStockG(page: Page) {
  return (await trpcQuery<{ totalG: number }>(page, "purchase.scrapStock", undefined)).totalG;
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
    const before = await scrapStockG(office);

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
    expect(await scrapStockG(office)).toBe(before + 980_000);
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
    const card = owner.getByTestId("approval-card").filter({ hasText: lot.number });
    await card.getByRole("button", { name: /^Review/ }).click();
    const review = owner.getByRole("dialog");
    await review.getByRole("button", { name: "Reject" }).click();
    await expect(review.getByText("Write why you are rejecting it.")).toBeVisible();
    await review.getByLabel("Note").fill("Weigh it again on our kanta");
    await review.getByRole("button", { name: "Reject" }).click();
    await expect(toast(owner, "Rejected")).toBeVisible();
    await expect(review).toBeHidden();
    await owner.goto("/approvals?status=rejected");
    await expect(owner.getByTestId("approval-card").filter({ hasText: lot.number })).toContainText("Weigh it again on our kanta");
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
    const owner = await newPage(browser);
    await open(owner, { role: "owner", width: 1280, path: "/purchase" });
    for (const width of [375, 1280]) {
      for (const scheme of ["light", "dark"] as const) {
        await owner.setViewportSize({ width, height: 900 });
        await owner.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        const shot = async (name: string) => {
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
        await owner.goto("/approvals");
        await expect(owner.getByTestId("approval-card").first()).toBeVisible();
        await shot("approvals");
        await owner.getByTestId("approval-card").filter({ hasText: shortLot.number }).getByRole("button", { name: /^Review/ }).click();
        await expect(owner.getByRole("dialog")).toContainText("Party kanta");
        await shot("approval-review");
        await owner.keyboard.press("Escape");
        await owner.goto("/purchase/new");
        await toWeightsStep(owner);
        await owner.getByLabel("Party kanta (kg)").fill("6540");
        await owner.getByLabel("Our kanta (kg)").fill("6320");
        await expect(owner.getByTestId("kanta-difference")).toHaveAttribute("data-state", "short");
        await shot("new-lot-weights");
        await owner.goto("/purchase/new");
        await shot("new-lot-vendor");
      }
    }
  });
});
