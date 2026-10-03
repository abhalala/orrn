import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * PL-W6 Store screens: /store, /store/receive, /store/issue, /store/exchange, /store/items,
 * /store/items/:id. Key rule: an issue beyond the balance is blocked (client and server). Also
 * RP18 (a double tap or a retry never posts twice), cancel (RP15), role gating, layout guards and
 * axe at 375/390/820/1280/1440 in both themes. The owner holds store.txn; office and viewer have
 * no store access. Needs the local stack and the seeded demo company (the seed clears the store).
 */

type Scheme = "light" | "dark";

type Item = { id: string; name: string; unit: string };
type Entry = { id: string; kind: "grn" | "mrs"; number: string; qtyMilli: number; cancelledAt: string | null };

async function open(page: Page, opts: { role?: LocalRole; width?: number; scheme?: Scheme; path: string }) {
  await page.setViewportSize({ width: opts.width ?? 390, height: 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto(opts.path);
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function trpcMutate<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API_URL}/trpc/${path}`, {
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    data: input,
  });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function trpcQuery<T>(page: Page, path: string, input?: unknown): Promise<T> {
  const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await page.context().request.get(`${API_URL}/trpc/${path}${qs}`, { headers: { origin: WEB_ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return (await res.json()).result.data as T;
}

function uniqueName(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/** A fresh item for one test, optionally with an opening GRN. Call after signing in. */
async function newItem(page: Page, opts: { prefix: string; unit?: string; category?: string; receiveMilli?: number }) {
  const name = uniqueName(opts.prefix);
  const unit = opts.unit ?? "kg";
  const { id } = await trpcMutate<{ id: string }>(page, "store.items.create", {
    name,
    unit,
    category: opts.category ?? "chemical",
  });
  if (opts.receiveMilli) {
    await trpcMutate(page, "store.receive", { itemId: id, qtyMilli: opts.receiveMilli, clientRequestId: `open-${id}` });
  }
  return { id, name, unit } satisfies Item;
}

async function balanceOf(page: Page, itemId: string): Promise<number> {
  const { items } = await trpcQuery<{ items: { id: string; balanceMilli: number }[] }>(page, "store.balances");
  return items.find((i) => i.id === itemId)?.balanceMilli ?? 0;
}

async function entriesOf(page: Page, itemId: string): Promise<Entry[]> {
  return (await trpcQuery<{ items: Entry[] }>(page, "store.txns", { itemId, limit: 100 })).items;
}

/**
 * The realistic demo store used by the layout, axe and screenshot tests: idempotent (fixed names,
 * fixed request ids), safe to call from parallel tests.
 */
const DEMO = [
  { name: "Cover flux", unit: "kg", category: "chemical", grn: 250_000, mrs: 42_500, purpose: "melt" },
  { name: "LDO", unit: "litre", category: "fuel", grn: 1_200_000, mrs: 380_000, purpose: "melt" },
  { name: "CR4 nitriding salt", unit: "kg", category: "chemical", grn: 50_000, mrs: 12_000, purpose: "nitriding" },
  { name: "Caustic soda", unit: "kg", category: "chemical", grn: 25_000, mrs: 25_000, purpose: "nitriding" },
  { name: "Nitrogen gas cylinder", unit: "piece", category: "gas", grn: 6_000 },
  { name: "Roller bearing 6205", unit: "piece", category: "spare", grn: 8_000, exchange: 1_000 },
] as const;

async function ensureDemoStore(page: Page): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  const list = async () => (await trpcQuery<{ items: { id: string; name: string }[] }>(page, "store.items.list")).items;
  let items = await list();
  for (const d of DEMO) {
    let found = items.find((i) => i.name === d.name);
    if (!found) {
      const res = await page.context().request.post(`${API_URL}/trpc/store.items.create`, {
        headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
        data: { name: d.name, unit: d.unit, category: d.category },
      });
      // A parallel test may have created it a moment ago (409): read it back.
      items = await list();
      found = items.find((i) => i.name === d.name);
      expect(found, `demo item ${d.name} (${res.status()})`).toBeTruthy();
    }
    const id = found!.id;
    ids[d.name] = id;
    await trpcMutate(page, "store.receive", {
      itemId: id,
      qtyMilli: d.grn,
      grnRef: "CH-2231",
      clientRequestId: `demo-grn-${id}`,
    });
    if ("mrs" in d) {
      await trpcMutate(page, "store.issue", {
        itemId: id,
        qtyMilli: d.mrs,
        purpose: d.purpose,
        refId: d.purpose === "melt" ? "K31" : null,
        clientRequestId: `demo-mrs-${id}`,
      });
    }
    if ("exchange" in d) {
      await trpcMutate(page, "store.exchange", {
        itemId: id,
        qtyOutMilli: d.exchange,
        qtyInMilli: d.exchange,
        note: "Worn bearing from press 1",
        clientRequestId: `demo-x-${id}`,
      });
    }
  }
  return ids;
}

async function pickItem(page: Page, name: string) {
  const box = page.getByRole("combobox", { name: "Item" });
  await box.click();
  await box.fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
  await expect(box).toHaveValue(name);
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

test.describe("issue beyond balance is blocked", () => {
  test("the form stops it before saving, and nothing is posted", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E short", receiveMilli: 5_000 });
    await page.goto(`/store/issue?item=${item.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Issue from store" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Item" })).toHaveValue(item.name);
    await expect(page.getByText("In store: 5 kg").first()).toBeVisible();

    const qty = page.getByLabel("Quantity");
    await qty.fill("7");
    // Shown as soon as it is true, tied to the field.
    const error = page.getByText("Only 5 kg in the store. Issue less, or receive the delivery first.");
    await expect(error).toBeVisible();
    await expect(qty).toHaveAttribute("aria-invalid", "true");

    await page.locator("label", { hasText: "Melt" }).click();
    await page.getByRole("button", { name: "Issue", exact: true }).click();
    await expect(qty).toBeFocused();
    await expect(page.locator("[data-slot='status-block']")).toHaveCount(0);
    expect(await balanceOf(page, item.id)).toBe(5_000);
    expect((await entriesOf(page, item.id)).filter((e) => e.kind === "mrs")).toHaveLength(0);

    // Exactly the balance is fine.
    await qty.fill("5");
    await expect(error).toHaveCount(0);
  });

  test("when the screen's balance is stale, the server refuses and the form says why", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E stale", receiveMilli: 5_000 });
    // The screen believes 100 kg are in the store (another storekeeper issued meanwhile).
    await page.route("**/trpc/**", async (route) => {
      const url = new URL(route.request().url());
      const procedures = decodeURIComponent(url.pathname.split("/trpc/")[1] ?? "").split(",");
      const index = procedures.indexOf("store.balances");
      if (index === -1 || route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      const entry = Array.isArray(body) ? body[index] : body;
      for (const row of entry?.result?.data?.items ?? []) if (row.id === item.id) row.balanceMilli = 100_000;
      await route.fulfill({ response, json: body });
    });
    await page.goto(`/store/issue?item=${item.id}`);
    await expect(page.getByText("In store: 100 kg").first()).toBeVisible();
    await page.getByLabel("Quantity").fill("7");
    await page.locator("label", { hasText: "Maintenance" }).click();
    await page.getByRole("button", { name: "Issue", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Not saved" })).toContainText(
      `Only 5 kg of ${item.name} in the store`,
    );
    await expect(page.locator("[data-slot='status-block']")).toHaveCount(0);
    expect(await balanceOf(page, item.id)).toBe(5_000);
  });
});

test.describe("store entries", () => {
  test("receive, then issue: numbers shown, balance follows", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E flux" });

    await page.goto("/store/receive");
    await pickItem(page, item.name);
    await page.getByLabel("Quantity").fill("25.5");
    await page.getByLabel("Challan or bill number").fill("CH-77");
    await page.getByRole("button", { name: "Receive", exact: true }).click();
    const done = page.locator("[data-slot='status-block']");
    await expect(done).toContainText("Received");
    await expect(done).toContainText(/GRN-\d+/);
    await expect(done).toContainText(`25.5 kg of ${item.name}`);
    await expect(page.getByRole("status").filter({ hasText: /Received\. GRN-\d+/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Receive another" })).toBeFocused();
    expect(await balanceOf(page, item.id)).toBe(25_500);

    await page.goto(`/store/items/${item.id}`);
    await expect(page.getByRole("heading", { level: 1, name: item.name })).toBeVisible();
    await page.getByRole("link", { name: "Issue", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/store/issue\\?item=${item.id}`));
    await expect(page.getByRole("combobox", { name: "Item" })).toHaveValue(item.name);
    await page.getByLabel("Quantity").fill("10");
    await page.locator("label", { hasText: "Melt" }).click();
    await page.getByLabel("Cast, die or job").fill("K31");
    await page.getByRole("button", { name: "Issue", exact: true }).click();
    await expect(done).toContainText("Issued");
    await expect(done).toContainText(/MRS-\d+/);
    expect(await balanceOf(page, item.id)).toBe(15_500);

    await page.getByRole("link", { name: item.name }).click();
    await expect(page.locator("[data-slot='status-block']")).toContainText("15.5");
    const list = page.getByRole("list", { name: "Entries" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText("Issued");
    await expect(list).toContainText("Received");
  });

  test("purpose is required on an issue; countable items take whole numbers", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E bearing", unit: "piece", category: "spare", receiveMilli: 4_000 });
    await page.goto(`/store/issue?item=${item.id}`);
    await page.getByLabel("Quantity").fill("1.5");
    await page.getByLabel("Quantity").blur();
    await expect(page.getByText("This item is counted in whole numbers.")).toBeVisible();
    await page.getByLabel("Quantity").fill("1");
    await page.getByRole("button", { name: "Issue", exact: true }).click();
    await expect(page.getByText("Choose what it is for.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Melt" })).toBeFocused();
    expect(await balanceOf(page, item.id)).toBe(4_000);
  });

  test("a double tap posts one GRN (RP18)", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E tap" });
    await page.goto(`/store/receive?item=${item.id}`);
    await page.getByLabel("Quantity").fill("12");
    await page.getByRole("button", { name: "Receive", exact: true }).dblclick();
    const done = page.locator("[data-slot='status-block']");
    await expect(done).toContainText("Received");
    const entries = await entriesOf(page, item.id);
    expect(entries.filter((e) => e.kind === "grn")).toHaveLength(1);
    await expect(done).toContainText(entries[0]!.number);
    expect(await balanceOf(page, item.id)).toBe(12_000);
  });

  test("a retry after a lost response returns the first GRN, not a second one (RP18)", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E retry" });
    await page.goto(`/store/receive?item=${item.id}`);
    await page.getByLabel("Quantity").fill("12");
    // The first submit reaches the server, but its answer is lost on the way back.
    let dropped = false;
    await page.route("**/trpc/store.receive**", async (route) => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await page.getByRole("button", { name: "Receive", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Not saved" })).toBeVisible();
    expect((await entriesOf(page, item.id)).filter((e) => e.kind === "grn")).toHaveLength(1);

    await page.getByRole("button", { name: "Receive", exact: true }).click();
    const done = page.locator("[data-slot='status-block']");
    await expect(done).toContainText("Received");
    const entries = await entriesOf(page, item.id);
    expect(entries.filter((e) => e.kind === "grn")).toHaveLength(1);
    await expect(done).toContainText(entries[0]!.number);
    expect(await balanceOf(page, item.id)).toBe(12_000);
  });

  test("exchange: old out under an MRS, new in under a GRN", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E belt", unit: "piece", category: "spare", receiveMilli: 3_000 });
    await page.goto(`/store/exchange?item=${item.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Exchange old for new" })).toBeVisible();
    await page.getByLabel("Old going out").fill("4");
    await expect(page.getByText("Only 3 pcs in the store. Issue less, or receive the delivery first.")).toBeVisible();
    await page.getByLabel("Old going out").fill("1");
    await page.getByLabel("New coming in").fill("1");
    await page.getByRole("button", { name: "Exchange", exact: true }).click();
    const done = page.locator("[data-slot='status-block']");
    await expect(done).toContainText("Exchanged");
    await expect(done).toContainText(/MRS-\d+/);
    await expect(done).toContainText(/New part in under GRN-\d+/);
    const entries = await entriesOf(page, item.id);
    expect(entries.map((e) => e.kind).sort()).toEqual(["grn", "grn", "mrs"]);
    expect(await balanceOf(page, item.id)).toBe(3_000);
  });

  test("cancel an entry with a reason; the store goes back (RP15)", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E cancel", receiveMilli: 10_000 });
    const [grn] = await entriesOf(page, item.id);
    await page.goto(`/store/items/${item.id}`);
    await page.getByRole("button", { name: `Open ${grn!.number}` }).click();
    const sheet = page.getByRole("dialog", { name: grn!.number });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("10 kg");
    await sheet.getByRole("button", { name: "Cancel entry" }).click();
    const reason = sheet.getByLabel("Why cancel it");
    await expect(reason).toBeFocused();
    await sheet.getByRole("button", { name: "Cancel entry" }).click();
    await expect(sheet.getByText("Write why you are cancelling it.")).toBeVisible();
    await reason.fill("Wrong quantity typed");
    await sheet.getByRole("button", { name: "Cancel entry" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText(`${grn!.number} cancelled`)).toBeVisible();
    await expect(page.getByRole("list", { name: "Entries" })).toContainText("Cancelled");
    expect(await balanceOf(page, item.id)).toBe(0);
    expect((await entriesOf(page, item.id))[0]!.cancelledAt).not.toBeNull();
  });

  test("add a store item, then find it in the store", async ({ page }) => {
    await open(page, { path: "/store/items" });
    const name = uniqueName("E2E LDO drum");
    await page.getByRole("button", { name: "Add item" }).first().click();
    const sheet = page.getByRole("dialog", { name: "Add store item" });
    await sheet.getByRole("button", { name: "Save item" }).click();
    await expect(sheet.getByText("Enter the item name.")).toBeVisible();
    await sheet.getByLabel("Name").fill(name);
    await sheet.getByLabel("Unit").selectOption("litre");
    await sheet.getByLabel("Category").selectOption("fuel");
    await sheet.getByRole("button", { name: "Save item" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText(`${name} added`)).toBeVisible();
    await page.getByLabel("Search items").fill(name);
    await page.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Fuel, counted in L")).toBeVisible();
    await expect(page.locator("[data-slot='status-block']")).toContainText("Empty");
  });
});

test.describe("who sees the store", () => {
  test("office and viewer: no Store in the menu, and the page says who it is for", async ({ page }) => {
    for (const role of ["office", "viewer"] as const) {
      await page.context().clearCookies();
      await open(page, { role, width: 1280, path: "/store" });
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Store" })).toHaveCount(0);
      await expect(page.getByText("The store is for the storekeeper")).toBeVisible();
      await expect(page.getByRole("link", { name: "Issue" })).toHaveCount(0);
    }
  });

  test("owner: Store is in the menu and opens the store", async ({ page }) => {
    await open(page, { width: 1280, path: "/today" });
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Store" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Store" })).toBeVisible();
  });

  test("a manager sees balances and entries but makes no entries", async ({ page }) => {
    // Client-side role only (the server still answers as the owner): proves the screen hides
    // what store.txn guards. The server matrix lives in plant-store.test.ts.
    await page.route("**/trpc/**", async (route) => {
      const url = new URL(route.request().url());
      const procedures = decodeURIComponent(url.pathname.split("/trpc/")[1] ?? "").split(",");
      const index = procedures.indexOf("auth.me");
      if (index === -1) return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      const entry = Array.isArray(body) ? body[index] : body;
      const me = entry?.result?.data?.json ?? entry?.result?.data;
      if (me?.company) me.company.role = "manager";
      await route.fulfill({ response, json: body });
    });
    await open(page, { width: 1280, path: "/store" });
    await expect(
      page.getByText("Only the storekeeper makes store entries. You can see what is in the store."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^Issue/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "In the store" })).toBeVisible();
    await page.goto("/store/issue");
    await expect(page.getByText("Only the storekeeper makes store entries")).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue", exact: true })).toHaveCount(0);
  });
});

test.describe("keyboard and language", () => {
  test("issue with the keyboard only", async ({ page }) => {
    await open(page, { path: "/today", width: 1280 });
    const item = await newItem(page, { prefix: "E2E keys", receiveMilli: 20_000 });
    await page.goto("/store/issue");
    const box = page.getByRole("combobox", { name: "Item" });
    await box.focus();
    await page.keyboard.type(item.name);
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(box).toHaveValue(item.name);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Quantity")).toBeFocused();
    await page.keyboard.type("2.5");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: "Melt" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Nitriding" })).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Cast, die or job")).toBeFocused();
    // Enter in a text field submits the form.
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-slot='status-block']")).toContainText("Issued");
    expect(await balanceOf(page, item.id)).toBe(17_500);
  });

  test("Hindi: store screens read in Hindi and nothing is clipped at 375", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
    await open(page, { width: 375, path: "/today" });
    const ids = await ensureDemoStore(page);
    await page.goto("/store");
    await expect(page.getByRole("heading", { level: 1, name: "स्टोर" })).toBeVisible();
    await expect(page.getByRole("link", { name: /माल दें/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, "main#main");
    await page.goto(`/store/issue?item=${ids["Cover flux"]}`);
    await expect(page.getByRole("heading", { level: 1, name: "स्टोर से माल दें" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoClippedText(page, "main#main");
  });
});

test.describe("layout and accessibility", () => {
  for (const width of [375, 390, 820, 1280, 1440]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`store pages at ${width}px (${scheme}): no sideways scroll, nothing clipped${width === 390 || width === 1280 ? ", axe clean" : ""}`, async ({
        page,
      }) => {
        await open(page, { width, scheme, path: "/today" });
        const ids = await ensureDemoStore(page);
        const pages = [
          { path: "/store", ready: page.getByRole("heading", { level: 2, name: "In the store" }) },
          { path: "/store/items", ready: page.getByRole("link", { name: "Cover flux" }) },
          {
            path: `/store/items/${ids["Roller bearing 6205"]}`,
            ready: page.getByRole("button", { name: /^Open MRS-/ }),
          },
          { path: `/store/issue?item=${ids["Cover flux"]}`, ready: page.getByText("In store now").first() },
          { path: "/store/receive", ready: page.getByRole("combobox", { name: "Item" }) },
          { path: `/store/exchange?item=${ids["Roller bearing 6205"]}`, ready: page.getByLabel("Old going out") },
        ];
        for (const p of pages) {
          await page.goto(p.path);
          await expect(p.ready.first()).toBeVisible();
          await page.waitForLoadState("networkidle");
          await expectNoHorizontalScroll(page);
          await expectNoClippedText(page, "main#main");
          if (width === 390 || width === 1280) expect(await blockingAxeViolations(page), p.path).toEqual([]);
        }
        if (width === 390 || width === 1280) {
          // Sheets: an entry and the item editor.
          await page.goto(`/store/items/${ids["Cover flux"]}`);
          await page
            .getByRole("button", { name: /^Open GRN-/ })
            .first()
            .click();
          await expect(page.getByRole("dialog")).toBeVisible();
          await page.getByRole("dialog").getByRole("button", { name: "Cancel entry" }).click();
          await expect(page.getByRole("dialog").getByLabel("Why cancel it")).toBeVisible();
          expect(await blockingAxeViolations(page), "entry sheet").toEqual([]);
          await expectNoClippedText(page, "[role='dialog']");
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toBeHidden();
          await page.getByRole("button", { name: "Edit item" }).click();
          await expect(page.getByRole("dialog", { name: "Edit store item" })).toBeVisible();
          expect(await blockingAxeViolations(page), "item sheet").toEqual([]);
        }
      });
    }
  }

  test("success block pops only with motion allowed", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E motion" });
    await page.goto(`/store/receive?item=${item.id}`);
    await page.getByLabel("Quantity").fill("1");
    await page.getByRole("button", { name: "Receive", exact: true }).click();
    const block = page.locator("[data-slot='status-block']");
    await expect(block).toBeVisible();
    expect(await block.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});

/**
 * Screenshots for review (not assertions): every store screen at 375 and 1280, light and dark.
 * Run with STORE_SHOTS_DIR=<dir> to write them.
 */
test.describe("screenshots", () => {
  const dir = process.env.STORE_SHOTS_DIR;
  test.skip(!dir, "set STORE_SHOTS_DIR to capture screenshots");
  for (const width of [375, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`capture at ${width} ${scheme}`, async ({ page }) => {
        mkdirSync(dir!, { recursive: true });
        const shot = (name: string) =>
          page.screenshot({ path: join(dir!, `${name}-${width}-${scheme}.png`), fullPage: true });
        await open(page, { width, scheme, path: "/today" });
        const ids = await ensureDemoStore(page);

        await page.goto("/store");
        await expect(page.getByRole("link", { name: "Cover flux" }).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await shot("store");

        await page.goto("/store/items");
        await expect(page.getByRole("link", { name: "Cover flux" }).first()).toBeVisible();
        await shot("store-items");

        await page.goto(`/store/items/${ids["Roller bearing 6205"]}`);
        await expect(page.getByRole("heading", { level: 2, name: "Entries" })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await shot("store-item");

        await page.goto(`/store/items/${ids["Caustic soda"]}`);
        await expect(page.getByRole("heading", { level: 2, name: "Entries" })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await shot("store-item-empty");

        await page.goto(`/store/issue?item=${ids["Cover flux"]}`);
        await page.getByLabel("Quantity").fill("500");
        await page.locator("label", { hasText: "Melt" }).click();
        await shot("store-issue-short");

        await page.goto("/store/receive");
        await expect(page.getByRole("combobox", { name: "Item" })).toBeVisible();
        await shot("store-receive");

        await page.goto(`/store/exchange?item=${ids["Roller bearing 6205"]}`);
        await expect(page.getByLabel("Old going out")).toBeVisible();
        await shot("store-exchange");

        const item = await newItem(page, { prefix: "Graphite paste", receiveMilli: 4_000 });
        await page.goto(`/store/issue?item=${item.id}`);
        await page.getByLabel("Quantity").fill("1.25");
        await page.locator("label", { hasText: "Maintenance" }).click();
        await page.getByRole("button", { name: "Issue", exact: true }).click();
        await expect(page.locator("[data-slot='status-block']")).toBeVisible();
        await shot("store-issue-done");

        await page.goto(`/store/items/${ids["Cover flux"]}`);
        await page
          .getByRole("button", { name: /^Open GRN-/ })
          .first()
          .click();
        await page.getByRole("dialog").getByRole("button", { name: "Cancel entry" }).click();
        await expect(page.getByRole("dialog").getByLabel("Why cancel it")).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(dir!, `store-entry-sheet-${width}-${scheme}.png`) });
        await page.keyboard.press("Escape");

        await page.getByRole("button", { name: "Edit item" }).click();
        await expect(page.getByRole("dialog", { name: "Edit store item" })).toBeVisible();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(dir!, `store-item-sheet-${width}-${scheme}.png`) });
      });
    }
  }

  test("capture Hindi at 375 light", async ({ page }) => {
    mkdirSync(dir!, { recursive: true });
    await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
    await open(page, { width: 375, path: "/today" });
    const ids = await ensureDemoStore(page);
    await page.goto("/store");
    await expect(page.getByRole("heading", { level: 1, name: "स्टोर" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: join(dir!, "store-hi-375-light.png"), fullPage: true });
    await page.goto(`/store/issue?item=${ids["Cover flux"]}`);
    await expect(page.getByText("अभी स्टोर में").first()).toBeVisible();
    await page.screenshot({ path: join(dir!, "store-issue-hi-375-light.png"), fullPage: true });
  });
});
