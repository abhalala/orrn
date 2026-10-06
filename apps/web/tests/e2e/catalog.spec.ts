import { mkdirSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL as API, WEB_ORIGIN as ORIGIN } from "./helpers/ports";
import { periodRange, trailingMonths } from "../../src/features/customers/period";
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
 * - Numbers (addendum §5): KPI tiles, the volume table, the leaderboard and the kg column are
 *   compared with the server's answer for the same range; a period switch is checked by the range
 *   the page asks for and by answers rewritten in flight (distinct figures, movement chips, Other).
 * - Unknown is never 0: a failed kg column or leaderboard total shows a retry, not "0.0".
 * - Every screen: no sideways scroll or clipped text at 390 and 1280, axe clean.
 *
 * Set T23_SHOTS=<dir> to also write screenshots of every screen at 375 and
 * 1280 in light and dark.
 */

const SHOTS = process.env.T23_SHOTS;

type Scheme = "light" | "dark";

async function open(page: Page, path: string, opts: { width: number; role?: LocalRole; scheme?: Scheme }) {
  await page.setViewportSize({ width: opts.width, height: 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(path);
  // A cold first load on a busy machine can take a while; the page itself is what is tested.
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 15_000 });
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

type TrpcItem = { result?: { data: unknown }; error?: unknown };

/** Returned by a `rewriteTrpc` callback: answer that call with a server error (500, retried). */
const SERVER_ERROR = Symbol("server error");

type Rewrite = { rewrite: (input: never, data: unknown) => unknown; asked: unknown[] };
const rewrites = new WeakMap<Page, Map<string, Rewrite>>();

/**
 * Rewrite one procedure's answers on their way to the page, batched or not: `rewrite(input, data)`
 * returns new data, SERVER_ERROR, or undefined to pass the real answer. The returned array fills
 * with every input the page asked with, so a test can check the range it sent. One route per page
 * serves every rewritten procedure: a batch can carry several, and only one route handles a request.
 */
async function rewriteTrpc<I = Record<string, unknown>>(
  page: Page,
  procedure: string,
  rewrite: (input: I, data: unknown) => unknown,
): Promise<I[]> {
  let table = rewrites.get(page);
  if (!table) {
    const routes = new Map<string, Rewrite>();
    table = routes;
    rewrites.set(page, routes);
    await page.route(/\/trpc\//, async (route) => {
      const url = new URL(route.request().url());
      const paths = decodeURIComponent(url.pathname.slice(url.pathname.indexOf("/trpc/") + "/trpc/".length)).split(",");
      if (route.request().method() !== "GET" || !paths.some((p) => routes.has(p))) return route.fallback();
      const batched = url.searchParams.get("batch") === "1";
      const inputs = JSON.parse(url.searchParams.get("input") ?? "null");
      const response = await route.fetch();
      const body = await response.json();
      const items: TrpcItem[] = batched ? body : [body];
      paths.forEach((path, i) => {
        const entry = routes.get(path);
        if (!entry) return;
        const input = (batched ? inputs?.[i] : inputs) as never;
        entry.asked.push(input);
        const item = items[i];
        if (!item?.result) return;
        const next = entry.rewrite(input, item.result.data);
        if (next === SERVER_ERROR) {
          items[i] = { error: { message: "Injected by the e2e", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path } } };
        } else if (next !== undefined) {
          item.result.data = next;
        }
      });
      const headers = { ...response.headers() };
      delete headers["content-length"];
      delete headers["content-encoding"];
      await route.fulfill({ status: response.status(), headers, body: JSON.stringify(batched ? items : items[0]) });
    });
  }
  const asked: I[] = [];
  table.set(procedure, { rewrite: rewrite as Rewrite["rewrite"], asked });
  return asked;
}

// A refetch still in flight through a rewrite route when a test ends must not fail it.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

/** The company's today (the demo company is on IST) as YYYY-MM-DD. */
async function companyToday(page: Page): Promise<string> {
  return page.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
  );
}

/** kg as every catalogue screen prints it (formatKgTotal): one decimal, Indian grouping. */
const kgText = (g: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(g / 1000);
const shareText = (pct: number) => `${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(pct)}%`;

type Leaderboard = {
  rows: { customerId: string; name: string; kgG: number; sharePct: number; rank: number; previousRank: number | null }[];
  otherKgG: number;
  otherSharePct: number;
  totalKgG: number;
};
type Summary = {
  totals: { dispatches: number; kgG: number; avgLoadKgG: number };
  series: { bucketStart: string; kgG: number }[];
  daysSinceLast: number | null;
  cadenceDays: number | null;
  openOrders: unknown;
  topSections: { sectionId: string | null; label: string; kgG: number; sharePct: number }[];
};

/** One KPI tile on a customer's page, by its label. */
function kpiTile(page: Page, label: string) {
  return page.locator("[data-slot='customer-kpis'] > *").filter({ has: page.getByText(label, { exact: true }) });
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

/**
 * Wait for the screen to finish loading. Not `networkidle`: the app shell keeps polling, so it may
 * never settle. Loading regions carry aria-busy and placeholders are skeletons (charts included,
 * while the lazy kit chunk loads); none of either left means the screen shows its data.
 */
async function settled(page: Page) {
  await expect(page.locator("main#main [aria-busy='true']")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("main#main [data-slot='skeleton']")).toHaveCount(0, { timeout: 15_000 });
}

async function expectCleanLayout(page: Page) {
  // Refetching lists and charts dim to 60% on purpose; check the settled screen.
  await settled(page);
  await expectNoHorizontalScroll(page);
  await expectNoClippedText(page, "main#main");
  expect(await blockingAxeViolations(page)).toEqual([]);
}

/**
 * Make every later request for these procedures fail (network error), then fire the window-focus
 * refetch React Query does on its own when someone comes back to the tab. Resolves once the failures
 * stop (retries included: 1 s, 2 s, 4 s apart).
 */
async function failBackgroundRefetch(page: Page, procedures: string[]) {
  let failed = 0;
  const pattern = new RegExp(`/trpc/[^?]*(${procedures.map((p) => p.replace(".", "\\.")).join("|")})`);
  await page.route(pattern, (route) => {
    failed += 1;
    return route.abort("failed");
  });
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => failed, { timeout: 15_000 }).toBeGreaterThan(0);
  let seen = -1;
  while (seen !== failed) {
    seen = failed;
    await page.waitForTimeout(5_000);
  }
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
    // Shown under Section code (and said once in the form's polite live region).
    await expect(page.locator("[id$='-sectionCode-error']")).toHaveText("This code belongs to a deleted die. Use a different code.");
    await expect(page.getByLabel("Section code")).toHaveAttribute("aria-invalid", "true");
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
      await expect(page).toHaveURL(/q=(%22)?14701/);
      const row = page.getByRole("link", { name: /PATTI 14701/ });
      await expect(row).toBeVisible();
      await expect(page.getByText("Active").first()).toBeVisible();
      await expectCleanLayout(page);
      await row.click();
      await expect(page.getByRole("heading", { level: 1, name: "PATTI 14701" })).toBeVisible();
      await expectCleanLayout(page);
    });
  }

  test("a shared link with a numeric search (?q=14701) keeps the search", async ({ page }) => {
    await open(page, "/dies?q=14701", { width: 1280 });
    await expect(page.getByLabel("Search dies")).toHaveValue("14701");
    await expect(page.getByRole("link", { name: /PATTI 14701/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /ANGLE 11250/ })).toHaveCount(0);
  });

  test("a failed background refetch keeps the die on screen instead of an error page", async ({ page }) => {
    await signInViaApi(page, "owner");
    const { id, sectionCode } = await createDie(page);
    await open(page, `/dies/${id}`, { width: 1280 });
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(sectionCode) })).toBeVisible();
    await settled(page);
    await failBackgroundRefetch(page, ["die.get"]);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(sectionCode) })).toBeVisible();
    await expect(page.getByText("Weight per 12 ft")).toBeVisible();
  });

  test("an operator can read a die but has no edit or delete", async ({ page }) => {
    await signInViaApi(page, "owner");
    const die = await createDie(page);
    await page.context().clearCookies();
    await open(page, `/dies/${die.id}`, { width: 390, role: "operator" });
    await expect(page.getByRole("heading", { level: 1, name: `PATTI ${die.sectionCode}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit die" })).toHaveCount(0);
    // Delete lives in the "More actions" menu; with nothing in it for this role the menu is gone.
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Delete die" })).toHaveCount(0);
    // The stock link is for everyone.
    await expect(page.getByRole("link", { name: "See stock" })).toBeVisible();
  });

  test("an operator who opens /dies/new or /customers/new is told their role can't add, with no form", async ({ page }) => {
    await open(page, "/dies/new", { width: 390, role: "operator" });
    await expect(page.getByRole("heading", { level: 1, name: "New die" })).toBeVisible();
    await expect(page.getByText("Your role can't add dies. Ask an admin if you need it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save die" })).toHaveCount(0);
    await expect(page.getByLabel("Section code")).toHaveCount(0);
    await page.getByRole("link", { name: "Back to dies" }).click();
    await expect(page).toHaveURL(/\/dies$/);
    await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);

    await page.goto("/customers/new");
    await expect(page.getByRole("heading", { level: 1, name: "New customer" })).toBeVisible();
    await expect(page.getByText("Your role can't add customers. Ask an admin if you need it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save customer" })).toHaveCount(0);
    await expect(page.getByLabel("GSTIN")).toHaveCount(0);
    await expectCleanLayout(page);
  });

  test("a die is deleted from the More actions menu after a confirm", async ({ page }) => {
    await signInViaApi(page, "owner");
    const die = await createDie(page);
    await open(page, `/dies/${die.id}`, { width: 1280 });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete die" }).click();
    const confirm = page.getByRole("dialog", { name: `Delete die PATTI ${die.sectionCode}?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete die" }).click();
    await expect(page.getByText("Die deleted")).toBeVisible();
    await expect(page).toHaveURL(/\/dies$/);
    const res = await page
      .context()
      .request.get(`${API}/trpc/die.get?input=${encodeURIComponent(JSON.stringify({ id: die.id }))}`, { headers: { origin: ORIGIN } });
    expect(res.status()).toBe(404);
  });

  test("the die search finds the code as the floor writes it (PATTI 14701)", async ({ page }) => {
    await open(page, "/dies", { width: 1280 });
    await page.getByLabel("Search dies").fill("PATTI 14701");
    await expect(page.getByRole("link", { name: /PATTI 14701/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /ANGLE 11250/ })).toHaveCount(0);
  });

  for (const [path, procedure, listName] of [
    ["/dies", "die.list", "Dies"],
    ["/customers", "customer.list", "Customers"],
  ] as const) {
    test(`${path} pages through the server 50 at a time`, async ({ page }) => {
      await signInViaApi(page, "owner");
      // Pretend the plant has 120 so there is a second page (the seed has fewer than 50); page two
      // answers with page one's rows so its pager stays on screen.
      let firstPage: unknown[] = [];
      const asked = await rewriteTrpc<{ offset?: number; limit?: number }>(page, procedure, (input, data) => {
        const answer = data as { items: unknown[] };
        if (!input.offset) firstPage = answer.items;
        return { ...answer, items: input.offset ? firstPage : answer.items, total: 120 };
      });
      await open(page, path, { width: 1280 });
      await expect(page.getByText(/^1-\d+ of 120$/)).toBeVisible();
      await page.getByRole("button", { name: "Next page" }).click();
      await expect(page).toHaveURL(/offset=50/);
      await expect.poll(() => asked.some((i) => i.offset === 50 && i.limit === 50)).toBe(true);
      await expect(page.getByText(/^51-\d+ of 120$/)).toBeVisible();
      await page.getByRole("button", { name: "Previous page" }).click();
      await expect(page).not.toHaveURL(/offset=/);
      await expect(page.getByText(/^1-\d+ of 120$/)).toBeVisible();
      await expect(page.getByRole("table", { name: listName, exact: true })).toBeVisible();
    });

    test(`a ${path} link past the last page offers the first page, not an empty catalogue`, async ({ page }) => {
      await open(page, `${path}?offset=5000`, { width: 390 });
      await expect(page.getByText("Nothing on this page.")).toBeVisible();
      await expect(page.getByText(path === "/dies" ? "No dies yet." : "No customers yet.")).toHaveCount(0);
      await page.getByRole("link", { name: "Go to the first page" }).click();
      await expect(page).not.toHaveURL(/offset=/);
      await expect(page.getByRole("list", { name: listName, exact: true })).toBeVisible();
    });
  }

  test("Import CSV sits in the More actions menu for roles that may import", async ({ page }) => {
    await open(page, "/dies", { width: 390 });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Import CSV" }).click();
    await expect(page.getByRole("dialog", { name: "Import dies" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.goto("/customers");
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Import CSV" })).toBeVisible();
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
    await expect(page.getByText("Rajkot, Gujarat 360002")).toHaveCount(2);
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
      await signInViaApi(page, "owner");
      const kd = await customerByName(page, "KD Extrusion");
      const today = await companyToday(page);
      const fy = periodRange("fy", today);
      const month = periodRange("month", today);
      const server = await trpcQuery<Leaderboard>(page, "analytics.customerLeaderboard", { ...fy, limit: 10 });

      await open(page, "/customers", { width });
      const period = page.getByRole("radiogroup", { name: "Period" });
      await expect(period.getByRole("radio", { name: "This year" })).toHaveAttribute("aria-checked", "true");
      const board = page.getByRole("group", { name: "Who is leading" });
      await expect(board).toBeVisible();
      const bars = board.getByRole("list", { name: "Customers by kg dispatched" });
      await expect(bars).toBeVisible();

      // The default period (this financial year to date) reads the server's numbers.
      await expect(board).toContainText(`kg dispatched per customer. ${kgText(server.totalKgG)} kg in all.`);
      expect(server.rows.length).toBeGreaterThan(0);
      for (const row of server.rows) {
        await expect(bars.getByRole("listitem").filter({ hasText: row.name })).toContainText(`${kgText(row.kgG)} kg`);
      }
      const kdRow = server.rows.find((r) => r.customerId === kd.id)!;
      await page.getByLabel("Search customers").fill("KD Extrusion");
      await expect(page).toHaveURL(/q=KD/);
      const list = page.getByRole(width >= 1024 ? "table" : "list", { name: "Customers", exact: true });
      await expect(list.getByText(kgText(kdRow.kgG), { exact: true })).toBeVisible();
      await settled(page);

      // This month: both the card and the kg column ask for the month and show what it answers.
      // The answers are rewritten in flight so the month's figures differ from the year's and carry
      // every movement kind (the seed has one dispatch per customer, all this month).
      const monthBoard: Leaderboard = {
        rows: [
          { customerId: kd.id, name: "KD Extrusion", kgG: 123_400, sharePct: 41.2, rank: 1, previousRank: 3 },
          { customerId: "e2e-royal", name: "Royal Aluminium", kgG: 98_000, sharePct: 32.7, rank: 2, previousRank: 1 },
          { customerId: "e2e-shivam", name: "Shivam Fabricators", kgG: 40_900, sharePct: 13.7, rank: 3, previousRank: null },
          { customerId: "e2e-tejura", name: "Tejura Windows", kgG: 0, sharePct: 0, rank: 4, previousRank: 4 },
        ].map((r) => ({ ...r, dispatches: 1, deltaPct: null })),
        otherKgG: 37_200,
        otherSharePct: 12.4,
        totalKgG: 299_500,
      };
      const isMonth = (i: { from?: string; to?: string }) => i.from === month.from && i.to === month.to && month.from !== fy.from;
      const boardAsked = await rewriteTrpc<{ from: string; to: string }>(page, "analytics.customerLeaderboard", (input, data) =>
        isMonth(input) ? { ...(data as object), ...monthBoard } : undefined,
      );
      const kgAsked = await rewriteTrpc<{ from: string; to: string }>(page, "analytics.customerKg", (input, data) =>
        isMonth(input) ? { ...(data as object), rows: [{ customerId: kd.id, kgG: 123_400, dispatches: 3 }] } : undefined,
      );
      await period.getByRole("radio", { name: "This month" }).click();
      await expect(page).toHaveURL(/period=month/);
      await expect(period.getByRole("radio", { name: "This month" })).toHaveAttribute("aria-checked", "true");
      // In April the month, quarter and year start together: one range, nothing new to ask.
      if (month.from !== fy.from) {
        await expect.poll(() => kgAsked.some((i) => i.from === month.from && i.to === month.to)).toBe(true);
        await expect.poll(() => boardAsked.some((i) => i.from === month.from && i.to === month.to)).toBe(true);
        await expect(list.getByText("123.4", { exact: true })).toBeVisible();
        await expect(board).toContainText("kg dispatched per customer. 299.5 kg in all.");
        await expect(bars.getByRole("listitem").filter({ hasText: "KD Extrusion" })).toContainText("Up 2");
        await expect(bars.getByRole("listitem").filter({ hasText: "Royal Aluminium" })).toContainText("Down 1");
        await expect(bars.getByRole("listitem").filter({ hasText: "Shivam Fabricators" })).toContainText("New");
        await expect(bars.getByRole("listitem").filter({ hasText: "Tejura Windows" })).toContainText("Same");
        await expect(board.getByText("Other customers (12.4%)")).toBeVisible();
      }
      await expectCleanLayout(page);
    });
  }

  test("a phone number finds its customer however it is typed (a shared ?q= link)", async ({ page }) => {
    await open(page, "/customers?q=09825011234", { width: 1280 });
    await expect(page.getByLabel("Search customers")).toHaveValue("09825011234");
    const list = page.getByRole("table", { name: "Customers", exact: true });
    await expect(list.getByRole("link", { name: /KD Extrusion/ })).toBeVisible();
    await expect(list.getByRole("link", { name: /Royal Aluminium/ })).toHaveCount(0);
  });

  test("a failed kg column says so and offers a retry instead of showing 0.0", async ({ page }) => {
    test.setTimeout(90_000);
    await signInViaApi(page, "owner");
    let fail = true;
    await rewriteTrpc(page, "analytics.customerKg", () => (fail ? SERVER_ERROR : undefined));
    await open(page, "/customers?q=KD%20Extrusion", { width: 1280 });
    const list = page.getByRole("table", { name: "Customers", exact: true });
    await expect(list.getByRole("link", { name: /KD Extrusion/ })).toBeVisible();
    // Three retries (1 s, 2 s, 4 s) before the read counts as failed.
    const notice = page.getByRole("status").filter({ hasText: "The dispatched kg didn't load." });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(list.getByRole("cell", { name: "0.0", exact: true })).toHaveCount(0);
    // The leaderboard card has its own read and keeps its numbers.
    await expect(page.getByRole("group", { name: "Who is leading" }).getByRole("list", { name: "Customers by kg dispatched" })).toBeVisible();

    fail = false;
    await notice.getByRole("button", { name: "Try again" }).click();
    await expect(notice).toBeHidden();
    const kd = await customerByName(page, "KD Extrusion");
    const today = await companyToday(page);
    const kg = await trpcQuery<{ rows: { customerId: string; kgG: number }[] }>(page, "analytics.customerKg", periodRange("fy", today));
    const kdKg = kg.rows.find((r) => r.customerId === kd.id)?.kgG ?? 0;
    await expect(list.getByRole("cell", { name: kgText(kdKg), exact: true })).toBeVisible();
  });

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

  test("on a phone the leaderboard table keeps names readable and fades the side that hides columns", async ({ page }) => {
    await open(page, "/customers", { width: 375 });
    const board = page.getByRole("group", { name: "Who is leading" });
    await board.getByRole("button", { name: "Show table" }).click();
    const table = board.getByRole("region", { name: "Who is leading" });
    await expect(table).toBeVisible();
    // AN-2 UX m5: the name column keeps 9rem, so "KD Extrusion" stays on one line instead of a word a line.
    const name = table.getByRole("rowheader", { name: "KD Extrusion" });
    expect((await name.boundingBox())!.width).toBeGreaterThanOrEqual(144);
    const fade = board.locator("[data-slot='chart-table-fade']");
    await expect(table).toHaveAttribute("data-hidden-end", "");
    await expect(fade).toHaveAttribute("data-side", "end");
    await table.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(table).not.toHaveAttribute("data-hidden-end", "");
    await expect(table).toHaveAttribute("data-hidden-start", "");
    await expect(fade).toHaveAttribute("data-side", "start");
    await expect(table.getByRole("columnheader", { name: "Movement" })).toBeInViewport();
    await expectCleanLayout(page);
  });

  test("a failed background refetch keeps the customer and their charts on screen", async ({ page }) => {
    await signInViaApi(page, "owner");
    const kd = await customerByName(page, "KD Extrusion");
    await open(page, `/customers/${kd.id}`, { width: 1280 });
    await expect(page.getByRole("heading", { level: 1, name: "KD Extrusion" })).toBeVisible();
    await settled(page);
    // Both the customer and its 12-month summary refetch on focus; a bad moment must not blank either.
    await failBackgroundRefetch(page, ["customer.get", "analytics.customerSummary"]);
    await expect(page.getByRole("heading", { level: 1, name: "KD Extrusion" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contact" })).toBeVisible();
    await expect(page.getByText("This chart didn't load")).toHaveCount(0);
  });

  test("the KPI tiles and the monthly volume table match the server's numbers", async ({ page }) => {
    await signInViaApi(page, "owner");
    const kd = await customerByName(page, "KD Extrusion");
    const today = await companyToday(page);
    const fy = periodRange("fy", today);
    const months = trailingMonths(today);
    const [summary, year, board] = await Promise.all([
      trpcQuery<Summary>(page, "analytics.customerSummary", { customerId: kd.id, ...fy, bucket: "month" }),
      trpcQuery<Summary>(page, "analytics.customerSummary", { customerId: kd.id, from: months.from, to: months.to, bucket: "month" }),
      trpcQuery<Leaderboard>(page, "analytics.customerLeaderboard", { ...fy, limit: 10 }),
    ]);
    await open(page, `/customers/${kd.id}`, { width: 1280 });
    await settled(page);

    await expect(kpiTile(page, "Dispatched").locator("[data-slot='big-number']")).toHaveText(kgText(summary.totals.kgG));
    await expect(kpiTile(page, "Dispatches").locator("[data-slot='big-number']")).toHaveText(String(summary.totals.dispatches));
    await expect(kpiTile(page, "Average load").locator("[data-slot='big-number']")).toHaveText(kgText(summary.totals.avgLoadKgG));
    // KD is on the leaderboard, so the tile shows the leaderboard's own share (same figure on both screens).
    const kdRow = board.rows.find((r) => r.customerId === kd.id)!;
    const share = kpiTile(page, "Share of all dispatches");
    await expect(share.locator("[data-slot='big-number']")).toHaveText(shareText(kdRow.sharePct));
    await expect(share).toContainText(`of ${kgText(board.totalKgG)} kg in all`);
    // No open orders yet (openOrders null until sales orders exist): no block at all.
    expect(summary.openOrders).toBeNull();
    await expect(page.getByRole("heading", { name: "Open orders" })).toHaveCount(0);

    const card = page.getByRole("group", { name: "Monthly volume" });
    await card.getByRole("button", { name: "Show table" }).click();
    const cells = card.getByRole("region", { name: "Monthly volume" }).locator("tbody tr td");
    await expect(cells).toHaveCount(12);
    await expect(cells).toHaveText(year.series.map((m) => `${kgText(m.kgG)} kg`));
  });

  test("a period switch re-scopes the tiles and sections; the header keeps its 12-month facts", async ({ page }) => {
    await signInViaApi(page, "owner");
    const kd = await customerByName(page, "KD Extrusion");
    const today = await companyToday(page);
    const fy = periodRange("fy", today);
    const month = periodRange("month", today);
    test.skip(month.from === fy.from, "in April the month and the year are one range");
    const months = trailingMonths(today);

    // Rewritten in flight: a cadence for the header (the seed has one dispatch per customer) and a
    // month whose figures differ from the year's, with open orders and an Other sections row.
    const summaryAsked = await rewriteTrpc<{ from: string; to: string }>(page, "analytics.customerSummary", (input, data) => {
      if (input.from === months.from) return { ...(data as object), daysSinceLast: 12, cadenceDays: 9.4 };
      if (input.from === month.from) {
        return {
          ...(data as object),
          totals: { dispatches: 3, bundles: 30, kgG: 123_400, pieces: 600, avgLoadKgG: 41_133 },
          topSections: [
            { sectionId: "e2e-s1", label: "PATTI 14701", kgG: 80_000, sharePct: 64.8, dispatches: 2 },
            { sectionId: null, label: "Other", kgG: 43_400, sharePct: 35.2, dispatches: 1 },
          ],
          openOrders: { orderedG: 5_000_000, dispatchedG: 3_200_000, bakiG: 1_800_000, lines: 4 },
        };
      }
      return undefined;
    });
    await rewriteTrpc<{ from: string }>(page, "analytics.customerLeaderboard", (input, data) =>
      input.from === month.from
        ? {
            ...(data as object),
            rows: [{ customerId: kd.id, name: "KD Extrusion", kgG: 123_400, sharePct: 41.2, dispatches: 3, rank: 1, previousRank: 2, deltaPct: null }],
            otherKgG: 176_100,
            otherSharePct: 58.8,
            totalKgG: 299_500,
          }
        : undefined,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.goto(`/customers/${kd.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "KD Extrusion" })).toBeVisible();
    await expect(page.locator("[data-slot='customer-facts']")).toHaveText("Last dispatch 12 days ago · every ~9 days");
    await settled(page);

    await page.getByRole("radiogroup", { name: "Period" }).getByRole("radio", { name: "This month" }).click();
    await expect(page).toHaveURL(/period=month/);
    await expect.poll(() => summaryAsked.some((i) => i.from === month.from && i.to === month.to)).toBe(true);
    await expect(kpiTile(page, "Dispatched").locator("[data-slot='big-number']")).toHaveText("123.4");
    await expect(kpiTile(page, "Dispatches").locator("[data-slot='big-number']")).toHaveText("3");
    await expect(kpiTile(page, "Average load").locator("[data-slot='big-number']")).toHaveText("41.1");
    await expect(kpiTile(page, "Share of all dispatches").locator("[data-slot='big-number']")).toHaveText("41.2%");
    await expect(kpiTile(page, "Share of all dispatches")).toContainText("of 299.5 kg in all");
    const sections = page.getByRole("group", { name: "What they buy" });
    await expect(sections.getByText("Other sections (35.2%)")).toBeVisible();
    const orders = page.getByRole("region", { name: "Open orders" });
    await expect(orders).toContainText("4 lines");
    await expect(orders).toContainText("1,800.0 kg");
    // The 12-month header facts do not follow the period.
    await expect(page.locator("[data-slot='customer-facts']")).toHaveText("Last dispatch 12 days ago · every ~9 days");
    await settled(page);
    await expectCleanLayout(page);
  });

  test("a failed leaderboard total leaves the share tile unknown with a retry, never 0.0%", async ({ page }) => {
    test.setTimeout(90_000);
    await signInViaApi(page, "owner");
    const kd = await customerByName(page, "KD Extrusion");
    let fail = true;
    await rewriteTrpc(page, "analytics.customerLeaderboard", () => (fail ? SERVER_ERROR : undefined));
    await open(page, `/customers/${kd.id}`, { width: 390 });
    const share = kpiTile(page, "Share of all dispatches");
    await expect(share).toContainText("The total didn't load.", { timeout: 20_000 });
    await expect(share.locator("[data-slot='big-number']")).toHaveCount(0);
    await expect(page.getByText("0.0%")).toHaveCount(0);
    // The other tiles come from their own read and keep their numbers.
    await expect(kpiTile(page, "Dispatches").locator("[data-slot='big-number']")).toBeVisible();

    fail = false;
    await share.getByRole("button", { name: "Try again" }).click();
    await expect(share.locator("[data-slot='big-number']")).toHaveText(/^\d+(\.\d)?%$/);
    await expect(share).toContainText("kg in all");
  });

  test("an untouched legacy GSTIN is kept and flagged; a changed one must be valid", async ({ page }) => {
    await signInViaApi(page, "owner");
    const name = `T23 Legacy ${unique()}`;
    const { id } = await trpcMutation<{ id: string }>(page, "customer.create", { name, phone: "+91 90000 00003", taxId: "24AABCK" });
    await open(page, `/customers/${id}`, { width: 390 });
    await page.getByRole("button", { name: "Edit customer" }).click();
    const sheet = page.getByRole("dialog", { name: `Edit ${name}` });
    await expect(sheet.getByText("This GSTIN isn't 15 letters and numbers. Check it against the GST certificate when you can.")).toBeVisible();
    await sheet.getByLabel("Phone").fill("+91 90000 00004");
    await sheet.getByRole("button", { name: "Save customer" }).click();
    await expect(page.getByText("Customer saved")).toBeVisible();
    const saved = await trpcQuery<{ taxId: string | null; phone: string | null }>(page, "customer.get", { id });
    expect(saved).toMatchObject({ taxId: "24AABCK", phone: "+91 90000 00004" });

    await page.getByRole("button", { name: "Edit customer" }).click();
    await sheet.getByLabel("GSTIN").fill("24AABCK44");
    await sheet.getByRole("button", { name: "Save customer" }).click();
    await expect(sheet.getByText("A GSTIN has 15 letters and numbers. Check it and try again.")).toBeVisible();
    await expect(sheet.getByLabel("GSTIN")).toHaveAttribute("aria-invalid", "true");
  });

  test("a customer is deleted from the edit sheet after a confirm", async ({ page }) => {
    await signInViaApi(page, "owner");
    const name = `T23 Gone ${unique()}`;
    const { id } = await trpcMutation<{ id: string }>(page, "customer.create", { name });
    await open(page, `/customers/${id}`, { width: 390 });
    await page.getByRole("button", { name: "Edit customer" }).click();
    const sheet = page.getByRole("dialog", { name: `Edit ${name}` });
    await sheet.getByRole("button", { name: "Delete customer" }).click();
    const confirm = page.getByRole("dialog", { name: `Delete ${name}?` });
    await expect(confirm).toBeVisible();
    // Focus moves into the confirm (it sits over the sheet, which must not keep it).
    await expect(confirm.locator(":focus")).toHaveCount(1);
    await confirm.getByRole("button", { name: "Delete customer" }).click();
    await expect(page.getByText("Customer deleted")).toBeVisible();
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const res = await page
      .context()
      .request.get(`${API}/trpc/customer.get?input=${encodeURIComponent(JSON.stringify({ id }))}`, { headers: { origin: ORIGIN } });
    expect(res.status()).toBe(404);
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

test.describe("dark", () => {
  for (const width of [390, 1280]) {
    test(`every screen is clean in dark at ${width} (no sideways scroll, no clipped text, axe)`, async ({ page }) => {
      test.setTimeout(120_000);
      await signInViaApi(page, "owner");
      const kd = await customerByName(page, "KD Extrusion");
      const dies = await trpcQuery<{ items: { id: string }[] }>(page, "die.list", { search: "14701", limit: 1 });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      for (const path of ["/dies", `/dies/${dies.items[0]!.id}`, "/dies/new", "/customers", `/customers/${kd.id}`, "/customers/new"]) {
        await page.goto(path);
        await expect(page.locator("main#main h1").first()).toBeVisible();
        await expectCleanLayout(page);
      }
    });
  }
});

/**
 * Full-page screenshot without Playwright's fullPage resize: that resize fires ResizeObservers
 * mid-capture, so charts and the segmented control's thumb are caught re-measuring (blank plot,
 * stray thumb). Grow the viewport to the page first, let it settle, then capture.
 */
async function shoot(page: Page, path: string) {
  const viewport = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height) });
  await page.waitForTimeout(500);
  await page.screenshot({ path });
  await page.setViewportSize(viewport);
}

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
          await settled(page);
          await shoot(page, `${SHOTS}/${name}-${width}-${scheme}.png`);
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
      // The leaderboard's table on a phone: names on one line, the fade over the hidden columns.
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto("/customers");
      const board = page.getByRole("group", { name: "Who is leading" });
      await board.getByRole("button", { name: "Show table" }).click();
      await expect(board.getByRole("region", { name: "Who is leading" })).toHaveAttribute("data-hidden-end", "");
      await board.screenshot({ path: `${SHOTS}/customers-table-375-${scheme}.png` });
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
        await settled(page);
        await shoot(page, `${SHOTS}/customer-detail-operator-${width}-${scheme}.png`);
      }
    }
  });
});
