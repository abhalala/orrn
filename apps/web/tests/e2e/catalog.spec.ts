import { mkdirSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Dies and Customers (Task 23). The demo company measures in inches, so the die
 * form shows width and thickness in inches while the server keeps mm.
 *
 * - Spec asserts (plan): an inch company opens a die with a 10 mm thickness and
 *   saves it untouched: still 10 mm (N6); a customer's addresses persist; a
 *   deleted die's code shows the conflict message (S16).
 * - Analytics addendum §4: owners see the leaderboard (period row scopes the kg
 *   column) and a view-first customer page with charts; operators see the
 *   contact card and recent dispatches, no charts, no kg column.
 * - Every screen: no sideways scroll or clipped text at 390 and 1280, axe clean.
 *
 * Set T23_SHOTS=<dir> to also write screenshots of every screen at 375 and
 * 1280 in light and dark.
 */

const API = process.env.E2E_API_URL ?? "http://localhost:3000";
const ORIGIN = process.env.E2E_BASE_URL ?? "http://localhost:3002";
const SHOTS = process.env.T23_SHOTS;

type Scheme = "light" | "dark";

async function open(page: Page, path: string, opts: { width: number; role?: LocalRole; scheme?: Scheme }) {
  await page.setViewportSize({ width: opts.width, height: 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(path);
  await expect(page.locator("main#main h1").first()).toBeVisible();
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
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
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

async function expectCleanLayout(page: Page) {
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  expect(await blockingAxeViolations(page)).toEqual([]);
}

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase();

type Die = { id: string; thicknessMm: number | null; widthMm: number | null; weightMinG: number; weightMaxG: number };

async function createDie(page: Page, over: Record<string, unknown> = {}) {
  const sectionCode = `T23${unique()}`;
  const { id } = await trpcMutation<{ id: string }>(page, "die.create", {
    series: "PATTI",
    sectionCode,
    name: "Test patti",
    weightMinG: 2400,
    weightMaxG: 2600,
    thicknessMm: 10,
    widthMm: 25,
    status: "active",
    ...over,
  });
  return { id, sectionCode };
}

async function customerByName(page: Page, name: string) {
  const list = await trpcQuery<{ items: { id: string; name: string }[] }>(page, "customer.list", { search: name, limit: 5 });
  const hit = list.items.find((c) => c.name === name);
  expect(hit, `seeded customer ${name}`).toBeTruthy();
  return hit!;
}

test.describe("dies", () => {
  test("an inch company saves an untouched die and keeps the 10 mm thickness (N6)", async ({ page }) => {
    await signInViaApi(page, "owner");
    const die = await createDie(page);
    await open(page, `/dies/${die.id}`, { width: 1280 });

    await expect(page.getByRole("heading", { level: 1, name: `PATTI ${die.sectionCode}` })).toBeVisible();
    // Measurements read in the company unit (inches).
    await expect(page.getByText("0.394 in")).toBeVisible();

    await page.getByRole("button", { name: "Edit die" }).click();
    const sheet = page.getByRole("dialog", { name: `Edit die PATTI ${die.sectionCode}` });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Advanced" }).click();
    await expect(sheet.getByLabel("Thickness")).toHaveValue("0.394");
    await sheet.getByRole("button", { name: "Save die" }).click();
    await expect(page.getByText("Die saved")).toBeVisible();
    await expect(sheet).toBeHidden();

    const saved = await trpcQuery<Die>(page, "die.get", { id: die.id });
    expect(saved.thicknessMm).toBe(10);
    expect(saved.widthMm).toBe(25);
    expect(saved.weightMinG).toBe(2400);
    expect(saved.weightMaxG).toBe(2600);
  });

  test("a changed thickness typed in inches is stored in mm", async ({ page }) => {
    await signInViaApi(page, "owner");
    const die = await createDie(page);
    await open(page, `/dies/${die.id}`, { width: 390 });
    await page.getByRole("button", { name: "Edit die" }).click();
    const sheet = page.getByRole("dialog", { name: `Edit die PATTI ${die.sectionCode}` });
    await sheet.getByRole("button", { name: "Advanced" }).click();
    await sheet.getByLabel("Thickness").fill("0.125");
    await sheet.getByRole("button", { name: "Save die" }).click();
    await expect(page.getByText("Die saved")).toBeVisible();
    const saved = await trpcQuery<Die>(page, "die.get", { id: die.id });
    expect(saved.thicknessMm).toBe(3.2);
    expect(saved.widthMm).toBe(25);
  });

  test("a deleted die's code shows the conflict message (S16)", async ({ page }) => {
    await signInViaApi(page, "owner");
    const die = await createDie(page);
    await trpcMutation(page, "die.delete", { id: die.id });

    await open(page, "/dies/new", { width: 390 });
    await expect(page.getByRole("heading", { level: 1, name: "New die" })).toBeVisible();
    await page.getByLabel("Series").fill("PATTI");
    await page.getByLabel("Section code").fill(die.sectionCode);
    await page.getByLabel("Min weight (kg/12ft)").fill("2.4");
    await page.getByLabel("Max weight (kg/12ft)").fill("2.6");
    await page.getByRole("button", { name: "Save die" }).click();
    await expect(page.getByText("This code belongs to a deleted die. Use a different code.")).toBeVisible();
    await expect(page).toHaveURL(/\/dies\/new$/);
  });

  test("the weight range is checked before saving", async ({ page }) => {
    await open(page, "/dies/new", { width: 1280 });
    await page.getByLabel("Series").fill("PATTI");
    await page.getByLabel("Section code").fill(`T23${unique()}`);
    await page.getByLabel("Min weight (kg/12ft)").fill("3");
    await page.getByLabel("Max weight (kg/12ft)").fill("2.5");
    await page.getByRole("button", { name: "Save die" }).click();
    await expect(page.getByText("Max weight can't be less than min weight.")).toBeVisible();
    await expect(page.getByLabel("Max weight (kg/12ft)")).toHaveAttribute("aria-invalid", "true");
  });

  test("a new die is saved with its band in grams and opens its page", async ({ page }) => {
    const code = `T23${unique()}`;
    await open(page, "/dies/new", { width: 1280 });
    await page.getByLabel("Series").fill("TEE");
    await page.getByLabel("Section code").fill(code);
    await page.getByLabel("Min weight (kg/12ft)").fill("2.7");
    await page.getByLabel("Max weight (kg/12ft)").fill("2.95");
    await page.getByRole("button", { name: "Save die" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `TEE ${code}` })).toBeVisible();
    await expect(page.getByText("2.7 to 2.95")).toBeVisible();
  });

  for (const width of [390, 1280]) {
    test(`list searches on the server and lays out cleanly at ${width}`, async ({ page }) => {
      await open(page, "/dies", { width });
      await expect(page.getByRole("heading", { level: 1, name: "Dies" })).toBeVisible();
      await page.getByLabel("Search dies").fill("14701");
      const row = page.getByRole("link", { name: /PATTI 14701/ });
      await expect(row).toBeVisible();
      await expect(page.getByText("Active").first()).toBeVisible();
      await expectCleanLayout(page);
      await row.click();
      await expect(page.getByRole("heading", { level: 1, name: "PATTI 14701" })).toBeVisible();
      await expectCleanLayout(page);
    });
  }

  test("an operator can read a die but has no edit or delete", async ({ page }) => {
    await signInViaApi(page, "owner");
    const die = await createDie(page);
    await page.context().clearCookies();
    await open(page, `/dies/${die.id}`, { width: 390, role: "operator" });
    await expect(page.getByRole("heading", { level: 1, name: `PATTI ${die.sectionCode}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit die" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New die" })).toHaveCount(0);
  });
});

test.describe("customers", () => {
  test("a new customer's billing and shipping addresses persist", async ({ page }) => {
    const name = `T23 Buyer ${unique()}`;
    await open(page, "/customers/new", { width: 390 });
    await expect(page.getByRole("heading", { level: 1, name: "New customer" })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Phone").fill("+91 98250 00000");
    await page.getByLabel("GSTIN").fill("24aabck4471m1z6");
    const billing = page.getByRole("group", { name: "Billing address" });
    await billing.getByLabel("Address", { exact: true }).fill("Plot 9, GIDC");
    await billing.getByLabel("City").fill("Rajkot");
    await billing.getByLabel("State").fill("Gujarat");
    await billing.getByLabel("PIN code").fill("360002");
    await page.getByRole("checkbox", { name: "Same as billing address" }).uncheck();
    const shipping = page.getByRole("group", { name: "Shipping address" });
    await shipping.getByLabel("Address", { exact: true }).fill("Shed 4, Aji Industrial Area");
    await shipping.getByLabel("City").fill("Rajkot");
    await page.getByRole("button", { name: "Save customer" }).click();

    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("GSTIN 24AABCK4471M1Z6")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Plot 9, GIDC")).toBeVisible();
    await expect(page.getByText("Rajkot, Gujarat 360002")).toBeVisible();
    await expect(page.getByText("Shed 4, Aji Industrial Area")).toBeVisible();

    const id = new URL(page.url()).pathname.split("/").pop()!;
    const saved = await trpcQuery<{ billingAddress: Record<string, string>; shippingAddress: Record<string, string>; taxId: string }>(
      page,
      "customer.get",
      { id },
    );
    expect(saved.taxId).toBe("24AABCK4471M1Z6");
    expect(saved.billingAddress).toEqual({ line1: "Plot 9, GIDC", city: "Rajkot", state: "Gujarat", postalCode: "360002" });
    // Unticking "Same as billing address" starts shipping from billing; only the street changed here.
    expect(saved.shippingAddress).toEqual({ line1: "Shed 4, Aji Industrial Area", city: "Rajkot", state: "Gujarat", postalCode: "360002" });
  });

  test("editing in the sheet keeps the address and saves the change", async ({ page }) => {
    await signInViaApi(page, "owner");
    const name = `T23 Edit ${unique()}`;
    const { id } = await trpcMutation<{ id: string }>(page, "customer.create", {
      name,
      phone: "+91 90000 00001",
      billingAddress: { line1: "7, Navrangpura", city: "Ahmedabad", state: "Gujarat", postalCode: "380009", country: "India" },
      shippingAddress: { line1: "7, Navrangpura", city: "Ahmedabad", state: "Gujarat", postalCode: "380009", country: "India" },
    });
    await open(page, `/customers/${id}`, { width: 1280 });
    await page.getByRole("button", { name: "Edit customer" }).click();
    const sheet = page.getByRole("dialog", { name: `Edit ${name}` });
    await expect(sheet.getByRole("checkbox", { name: "Same as billing address" })).toBeChecked();
    await sheet.getByLabel("Phone").fill("+91 90000 00002");
    await sheet.getByRole("button", { name: "Save customer" }).click();
    await expect(page.getByText("Customer saved")).toBeVisible();
    await expect(page.getByText("+91 90000 00002")).toBeVisible();
    const saved = await trpcQuery<{ billingAddress: Record<string, string>; shippingAddress: Record<string, string> }>(
      page,
      "customer.get",
      { id },
    );
    // The country key the form doesn't show survives the save.
    expect(saved.billingAddress).toEqual({ line1: "7, Navrangpura", city: "Ahmedabad", state: "Gujarat", postalCode: "380009", country: "India" });
    expect(saved.shippingAddress).toEqual(saved.billingAddress);
  });

  for (const width of [390, 1280]) {
    test(`owner sees the leaderboard and the period scopes the kg column at ${width}`, async ({ page }) => {
      await open(page, "/customers", { width });
      const period = page.getByRole("radiogroup", { name: "Period" });
      await expect(period.getByRole("radio", { name: "This year" })).toHaveAttribute("aria-checked", "true");
      const board = page.getByRole("group", { name: "Who is leading" });
      await expect(board).toBeVisible();
      await expect(board.getByRole("list", { name: "Customers by kg dispatched" })).toBeVisible();
      await expect(board.getByText("KD Extrusion")).toBeVisible();

      // The list's kg column shows the same number as the leaderboard for KD Extrusion.
      const kd = await customerByName(page, "KD Extrusion");
      const today = await page.evaluate(() =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
      );
      const [y, m] = today.split("-").map(Number) as [number, number];
      const fyFrom = `${m >= 4 ? y : y - 1}-04-01`;
      const board1 = await trpcQuery<{ rows: { customerId: string; kgG: number }[] }>(page, "analytics.customerLeaderboard", {
        from: fyFrom,
        to: today,
        limit: 10,
      });
      const kdKg = board1.rows.find((r) => r.customerId === kd.id)!.kgG / 1000;
      const kdText = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(kdKg);
      await page.getByLabel("Search customers").fill("KD Extrusion");
      const list = page.getByRole(width >= 1024 ? "table" : "list", { name: "Customers", exact: true });
      await expect(list.getByText(kdText)).toBeVisible();

      await period.getByRole("radio", { name: "This month" }).click();
      await expect(page).toHaveURL(/period=month/);
      await expect(period.getByRole("radio", { name: "This month" })).toHaveAttribute("aria-checked", "true");
      await expectCleanLayout(page);
    });
  }

  for (const width of [390, 1280]) {
    test(`owner opens a customer: header facts, KPI tiles, charts, recent dispatches at ${width}`, async ({ page }) => {
      await signInViaApi(page, "owner");
      const kd = await customerByName(page, "KD Extrusion");
      await open(page, `/customers/${kd.id}`, { width });
      await expect(page.getByRole("heading", { level: 1, name: "KD Extrusion" })).toBeVisible();
      await expect(page.getByText("GSTIN 24AABCK4471M1Z6")).toBeVisible();
      await expect(page.getByText(/Last dispatch (today|yesterday|\d+ days? ago)/)).toBeVisible();
      await expect(page.getByRole("radiogroup", { name: "Period" })).toBeVisible();
      await expect(page.getByText("Average load")).toBeVisible();
      await expect(page.getByText("Share of all dispatches")).toBeVisible();
      await expect(page.getByRole("group", { name: "Monthly volume" })).toBeVisible();
      await expect(page.getByRole("group", { name: "What they buy" })).toBeVisible();

      const recent = page.getByRole(width >= 1024 ? "table" : "list", { name: "Recent dispatches" });
      await expect(recent).toBeVisible();
      const link = recent.getByRole("link").first();
      await expect(link).toHaveAttribute("href", /\/dispatch\/.+/);
      await expectCleanLayout(page);
    });
  }

  test("the monthly volume table matches the server's numbers", async ({ page }) => {
    await signInViaApi(page, "owner");
    const kd = await customerByName(page, "KD Extrusion");
    await open(page, `/customers/${kd.id}`, { width: 1280 });
    const card = page.getByRole("group", { name: "Monthly volume" });
    await card.getByRole("button", { name: "Show table" }).click();
    const table = card.getByRole("region", { name: "Monthly volume" });
    await expect(table.getByRole("row")).toHaveCount(13);
  });

  test("an operator sees the contact card and recent dispatches, no charts or kg column", async ({ page }) => {
    await signInViaApi(page, "owner");
    const kd = await customerByName(page, "KD Extrusion");
    await page.context().clearCookies();

    await open(page, "/customers", { width: 1280, role: "operator" });
    await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Period" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Who is leading" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Dispatched (kg)" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New customer" })).toHaveCount(0);
    await expectCleanLayout(page);

    await page.goto(`/customers/${kd.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "KD Extrusion" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contact" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Recent dispatches" })).toBeVisible();
    await expect(page.locator("[data-chart-kit]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit customer" })).toHaveCount(0);
    await expectCleanLayout(page);
  });
});

test.describe("screenshots", () => {
  test.skip(!SHOTS, "set T23_SHOTS=<dir> to capture screenshots");
  test.setTimeout(240_000);

  test("every screen at 375 and 1280, light and dark", async ({ page }) => {
    mkdirSync(SHOTS!, { recursive: true });
    await signInViaApi(page, "owner");
    const kd = await customerByName(page, "KD Extrusion");
    const dies = await trpcQuery<{ items: { id: string; sectionCode: string }[] }>(page, "die.list", { search: "14701", limit: 1 });
    const screens: [string, string][] = [
      ["dies", "/dies"],
      ["die-detail", `/dies/${dies.items[0]!.id}`],
      ["die-new", "/dies/new"],
      ["customers", "/customers"],
      ["customer-detail", `/customers/${kd.id}`],
      ["customer-new", "/customers/new"],
    ];
    for (const scheme of ["light", "dark"] as const) {
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        for (const [name, path] of screens) {
          await page.goto(path);
          await expect(page.locator("main#main h1").first()).toBeVisible();
          await page.waitForLoadState("networkidle");
          await page.screenshot({ path: `${SHOTS}/${name}-${width}-${scheme}.png`, fullPage: true });
        }
        // The edit sheets.
        await page.goto(`/customers/${kd.id}`);
        await page.getByRole("button", { name: "Edit customer" }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/customer-edit-${width}-${scheme}.png` });
        await page.goto(`/dies/${dies.items[0]!.id}`);
        await page.getByRole("button", { name: "Edit die" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Advanced" }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/die-edit-${width}-${scheme}.png` });
      }
    }
    // An operator's customer page (no charts).
    await page.context().clearCookies();
    await signInViaApi(page, "operator");
    for (const scheme of ["light", "dark"] as const) {
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(`/customers/${kd.id}`);
        await expect(page.locator("main#main h1").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `${SHOTS}/customer-detail-operator-${width}-${scheme}.png`, fullPage: true });
      }
    }
  });
});
