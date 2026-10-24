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
  // First load after sign-in: generous, the machine runs several e2e suites at once.
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 15_000 });
}

async function trpcMutate<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API_URL}/trpc/${path}`, {
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    data: input,
  });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

/**
 * A demo-seed entry with a fixed clientRequestId. Parallel tests seed the same demo items; when two
 * of them send the same issue at the same moment, the twin that loses the balance guard is told
 * "Only 0 kg ..." instead of getting the winner's entry back (server: the lost-write path does not
 * re-check the request id; bulletin PLW6 2026-10-04). A retry a moment later looks the id up first
 * and replays the winner's entry, which is what a person's retry would get.
 */
async function demoMutate(page: Page, path: string, input: unknown): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const res = await page.context().request.post(`${API_URL}/trpc/${path}`, {
      headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
      data: input,
    });
    if (res.ok()) return;
    const body = await res.text();
    if (res.status() !== 400 || attempt >= 6) {
      expect(res.ok(), `${path} returned ${res.status()}: ${body}`).toBe(true);
    }
    await page.waitForTimeout(400 * attempt);
  }
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
  // Enough for the screenshot runs to issue 1.25 kg each without running out (the seed clears the store).
  { name: "Graphite paste", unit: "kg", category: "other", grn: 40_000 },
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
    await demoMutate(page, "store.receive", {
      itemId: id,
      qtyMilli: d.grn,
      grnRef: "CH-2231",
      clientRequestId: `demo-grn-${id}`,
    });
    if ("mrs" in d) {
      await demoMutate(page, "store.issue", {
        itemId: id,
        qtyMilli: d.mrs,
        purpose: d.purpose,
        refId: d.purpose === "melt" ? "K31" : null,
        clientRequestId: `demo-mrs-${id}`,
      });
    }
    if ("exchange" in d) {
      await demoMutate(page, "store.exchange", {
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

  test("on a 375x812 phone, a refused Issue brings the reason clear of the sticky bar", async ({ page }) => {
    await open(page, { width: 375, path: "/today" });
    await page.setViewportSize({ width: 375, height: 812 });
    const item = await newItem(page, { prefix: "E2E bar", receiveMilli: 5_000 });
    await page.goto(`/store/issue?item=${item.id}`);
    await page.getByLabel("Quantity").fill("7");
    await page.locator("label", { hasText: "Melt" }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "Issue", exact: true }).click();
    const error = page.getByText("Only 5 kg in the store. Issue less, or receive the delivery first.");
    await expect(page.getByLabel("Quantity")).toBeFocused();
    // toBeVisible ignores what covers an element: compare the boxes with the sticky bar instead.
    await expect
      .poll(async () => {
        const e = await error.boundingBox();
        const bar = await page.locator("[data-slot='form-actions']").boundingBox();
        return Boolean(e && bar && e.y >= 56 && e.y + e.height <= bar.y);
      })
      .toBe(true);
  });

  test("on a 375x812 phone, the Exchange quantities sit level and a focused one scrolls clear of the sticky bar, also in Hindi", async ({
    page,
  }) => {
    test.setTimeout(90_000); // two languages, four page loads
    await open(page, { width: 375, path: "/today" });
    await page.setViewportSize({ width: 375, height: 812 });
    const item = await newItem(page, { prefix: "E2E pair", unit: "piece", receiveMilli: 4_000 });
    const bar = page.locator("[data-slot='form-actions']");
    for (const lang of ["en", "hi"] as const) {
      await page.evaluate((l) => localStorage.setItem("orrn.locale", l), lang);
      await page.goto(`/store/exchange?item=${item.id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(lang === "hi" ? /[ऀ-ॿ]/ : "Exchange old for new");
      const inputs = page.locator("form input[inputmode='decimal']");
      await expect(inputs).toHaveCount(2);
      await page.evaluate(() => window.scrollTo(0, 0));
      const [oldBox, newBox] = [await inputs.nth(0).boundingBox(), await inputs.nth(1).boundingBox()];
      expect(Math.abs(oldBox!.y - newBox!.y), `${lang}: the two fields are level`).toBeLessThan(1);
      await expectNoClippedText(page, "main#main");
      // Focus moves by keyboard from the old to the new quantity: each lands clear of the bar.
      for (const i of [0, 1]) {
        if (i === 0) await inputs.nth(0).focus();
        else await page.keyboard.press("Tab");
        await expect(inputs.nth(i)).toBeFocused();
        await expect
          .poll(async () => {
            const box = await inputs.nth(i).boundingBox();
            const b = await bar.boundingBox();
            return Boolean(box && b && box.y >= 56 && box.y + box.height <= b.y);
          }, `${lang}: field ${i} clear of the sticky bar`)
          .toBe(true);
      }
    }
    await page.evaluate(() => localStorage.setItem("orrn.locale", "en"));
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
    const alert = page.getByRole("alert").filter({ hasText: "Not saved" });
    // The screen's own words, never the server's English ("Only 5 kg of ... in the store").
    await expect(alert).toHaveText(
      "Not saved. The store has less than this now. Check what is in the store and change the quantity.",
    );
    // Focus follows the failure (the submit button blurred while it loaded).
    await expect(alert).toBeFocused();
    await expect(page.locator("[data-slot='status-block']")).toHaveCount(0);
    expect(await balanceOf(page, item.id)).toBe(5_000);
    // A refusal is about the values sent: changing the quantity clears it.
    await page.getByLabel("Quantity").fill("4");
    await expect(alert).toHaveCount(0);
    // Background refetches may still be inside the route handler when the test ends.
    await page.unrouteAll({ behavior: "ignoreErrors" });
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
    // The live region must exist before its text arrives, or screen readers stay silent: hold the
    // node from before the submit and check it is the one that says "Received. GRN-n".
    const live = await page.locator("main p[role='status']").elementHandle();
    expect(live).not.toBeNull();
    expect(await live!.textContent()).toBe("");
    await page.getByRole("button", { name: "Receive", exact: true }).click();
    const done = page.locator("[data-slot='status-block']");
    await expect(done).toContainText("Received");
    await expect(done).toContainText(/GRN-\d+/);
    await expect(done).toContainText(`25.5 kg of ${item.name}`);
    expect(await live!.evaluate((el) => el.isConnected)).toBe(true);
    expect(await live!.textContent()).toMatch(/^Received\. GRN-\d+\. 25\.5 kg of /);
    await expect(page.getByRole("status").filter({ hasText: /Received\. GRN-\d+/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Back to store" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Receive another" })).toBeFocused();
    expect(await balanceOf(page, item.id)).toBe(25_500);

    await page.goto(`/store/items/${item.id}`);
    await expect(page.getByRole("heading", { level: 1, name: item.name })).toBeVisible();
    // With stock, Issue is the loud action.
    await expect(page.getByRole("link", { name: "Issue", exact: true })).toHaveAttribute("data-variant", "primary");
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

    await page.getByRole("link", { name: `Open ${item.name}` }).click();
    await expect(page.locator("[data-slot='status-block']")).toContainText("15.5");
    const list = page.getByRole("list", { name: "Entries" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText("Issued");
    await expect(list).toContainText("Received");
    // C2 formatting: d MMM and a 24-hour time in the plant's zone, never am/pm.
    await expect(list.getByRole("listitem").first()).toContainText(/\d{1,2} \w{3}, \d{2}:\d{2}/);
    await expect(list).not.toContainText(/\d (am|pm)\b/i);
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
    // Not "Not saved": it was saved, only the answer was lost.
    await expect(page.getByRole("alert")).toHaveText(
      "orrn didn't confirm this save, so it may have gone through. Tap Receive again to check: the same entry is never saved twice.",
    );
    expect((await entriesOf(page, item.id)).filter((e) => e.kind === "grn")).toHaveLength(1);

    await page.getByRole("button", { name: "Receive", exact: true }).click();
    const done = page.locator("[data-slot='status-block']");
    await expect(done).toContainText("Received");
    const entries = await entriesOf(page, item.id);
    expect(entries.filter((e) => e.kind === "grn")).toHaveLength(1);
    await expect(done).toContainText(entries[0]!.number);
    expect(await balanceOf(page, item.id)).toBe(12_000);
  });

  test("a server fault (5xx) after the save is not 'Not saved': the retry returns the first GRN (RP18)", async ({
    page,
  }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E fault" });
    await page.goto(`/store/receive?item=${item.id}`);
    await page.getByLabel("Quantity").fill("7");
    // The entry is written, then the answer is a tRPC 500 (a handler that threw after its batch).
    let calls = 0;
    await page.route("**/trpc/store.receive**", async (route) => {
      calls += 1;
      if (calls > 1) return route.continue();
      await route.fetch();
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify([
          {
            error: {
              message: "Something broke after the write",
              code: -32603,
              data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: "store.receive" },
            },
          },
        ]),
      });
    });
    const receive = page.getByRole("button", { name: "Receive", exact: true });
    await receive.click();
    await expect(page.getByRole("alert")).toContainText("orrn didn't confirm this save");
    await expect(page.getByRole("alert")).not.toContainText("Something broke");
    await receive.click();
    const done = page.locator("[data-slot='status-block']");
    await expect(done).toContainText("Received");
    expect(calls).toBe(2);
    const entries = await entriesOf(page, item.id);
    expect(entries.filter((e) => e.kind === "grn")).toHaveLength(1);
    await expect(done).toContainText(entries[0]!.number);
    expect(await balanceOf(page, item.id)).toBe(7_000);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("Issue: a retry after a lost response returns the first MRS, though the balance now looks short (RP18)", async ({
    page,
  }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, { prefix: "E2E lost issue", receiveMilli: 10_000 });
    await page.goto(`/store/issue?item=${item.id}`);
    await page.getByLabel("Quantity").fill("8");
    await page.locator("label", { hasText: "Melt" }).click();
    // The first submit is saved, but its answer never comes back.
    let calls = 0;
    await page.route("**/trpc/store.issue**", async (route) => {
      calls += 1;
      if (calls > 1) return route.continue();
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    const issue = page.getByRole("button", { name: "Issue", exact: true });
    await issue.click();
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText(
      "orrn didn't confirm this save, so it may have gone through. Tap Issue again to check: the same entry is never saved twice.",
    );
    const [first] = (await entriesOf(page, item.id)).filter((e) => e.kind === "mrs");
    expect(first, "the lost request was saved").toBeTruthy();
    // The store refetched (2 kg left), but these values may be that very entry: no "Only 2 kg".
    await expect(page.getByText("In store: 2 kg").first()).toBeVisible();
    await expect(page.getByText(/^Only 2 kg in the store/)).toHaveCount(0);

    await issue.click();
    const done = page.locator("[data-slot='status-block']");
    await expect(done).toContainText("Issued");
    await expect(done).toContainText(first!.number);
    expect(calls).toBe(2);
    expect((await entriesOf(page, item.id)).filter((e) => e.kind === "mrs")).toHaveLength(1);
    expect(await balanceOf(page, item.id)).toBe(2_000);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("Exchange: a retry after a lost response returns the first exchange (RP18)", async ({ page }) => {
    await open(page, { path: "/today" });
    const item = await newItem(page, {
      prefix: "E2E lost exchange",
      unit: "piece",
      category: "spare",
      receiveMilli: 3_000,
    });
    await page.goto(`/store/exchange?item=${item.id}`);
    await page.getByLabel("Old going out").fill("3");
    await page.getByLabel("New coming in").fill("1");
    let calls = 0;
    await page.route("**/trpc/store.exchange**", async (route) => {
      calls += 1;
      if (calls > 1) return route.continue();
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    const submit = page.getByRole("button", { name: "Exchange", exact: true });
    await submit.click();
    await expect(page.getByRole("alert")).toContainText("orrn didn't confirm this save");
    await expect(page.getByText("In store: 1 pcs").first()).toBeVisible();
    await expect(page.getByText(/^Only 1 pcs in the store/)).toHaveCount(0);
    await submit.click();
    await expect(page.locator("[data-slot='status-block']")).toContainText("Exchanged");
    expect(calls).toBe(2);
    const entries = await entriesOf(page, item.id);
    expect(entries.map((e) => e.kind).sort()).toEqual(["grn", "grn", "mrs"]);
    expect(await balanceOf(page, item.id)).toBe(1_000);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("a failed submit on an empty form focuses the item without opening its list", async ({ page }) => {
    await open(page, { path: "/today" });
    await newItem(page, { prefix: "E2E blank", receiveMilli: 1_000 });
    await page.goto("/store/issue");
    await page.getByRole("button", { name: "Issue", exact: true }).click();
    const box = page.getByRole("combobox", { name: "Item" });
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute("aria-expanded", "false");
    // The other problems stay readable.
    await expect(page.getByText("Enter the quantity.")).toBeVisible();
    await expect(page.getByText("Choose what it is for.")).toBeVisible();
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
    // An empty item leads with Receive: nothing can be issued or exchanged out of it yet.
    const main = page.getByRole("main");
    const receive = main.getByRole("link", { name: "Receive", exact: true });
    await expect(receive).toHaveAttribute("data-variant", "primary");
    await expect(main.getByRole("link", { name: "Issue", exact: true })).toHaveAttribute("data-variant", "secondary");
    const order = await main
      .locator("a[data-variant]")
      .evaluateAll((els) => els.map((el) => el.textContent?.trim()).filter((x) => /^(Issue|Receive|Exchange)$/.test(x ?? "")));
    expect(order).toEqual(["Receive", "Issue", "Exchange"]);
  });
});

test.describe("store items", () => {
  test("a new item with no entries can still change its unit", async ({ page }) => {
    await open(page, { width: 1280, path: "/today" });
    const item = await newItem(page, { prefix: "E2E unit" });
    await page.goto(`/store/items/${item.id}`);
    await expect(page.locator("[data-slot='status-block']")).toContainText("Empty");
    await page.getByRole("button", { name: "Edit item" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit store item" });
    await expect(sheet.getByLabel("Unit")).toBeEnabled();
    await sheet.getByLabel("Unit").selectOption("litre");
    await sheet.getByRole("button", { name: "Save item" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("counted in L")).toBeVisible();
  });

  test("rename, retire only when empty, bring back", async ({ page }) => {
    await open(page, { width: 1280, path: "/today" });
    const item = await newItem(page, { prefix: "E2E retire", receiveMilli: 2_000 });
    await page.goto(`/store/items/${item.id}`);
    await expect(page.locator("[data-slot='status-block']")).toContainText("In stock");

    // With stock left, Retire is off and says why.
    await page.getByRole("button", { name: "Edit item" }).click();
    let sheet = page.getByRole("dialog", { name: "Edit store item" });
    await expect(sheet.getByText("2 kg is still in the store. Issue it or cancel its entries before retiring the item.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Retire item" })).toBeDisabled();
    // It has an entry, so the unit is locked (the server refuses a change) and the hint says why.
    await expect(sheet.getByLabel("Unit")).toBeDisabled();
    await expect(sheet.getByText("The unit can't change after the item's first entry.")).toBeVisible();
    const renamed = `${item.name} R`;
    await sheet.getByLabel("Name").fill(renamed);
    await sheet.getByRole("button", { name: "Save item" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();

    // Empty: Retire works, then the item can be brought back.
    await trpcMutate(page, "store.issue", {
      itemId: item.id,
      qtyMilli: 2_000,
      purpose: "maintenance",
      clientRequestId: `empty-${item.id}`,
    });
    await page.reload();
    await expect(page.locator("[data-slot='status-block']")).toContainText("Empty");
    await page.getByRole("button", { name: "Edit item" }).click();
    sheet = page.getByRole("dialog", { name: "Edit store item" });
    await sheet.getByRole("button", { name: "Retire item" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText(`${renamed} retired`)).toBeVisible();
    await expect(page.locator("[data-slot='status-block']")).toContainText("Retired");
    await expect(page.getByRole("link", { name: "Receive", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit item" }).click();
    sheet = page.getByRole("dialog", { name: "Edit store item" });
    await sheet.getByRole("button", { name: "Bring back into use" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator("[data-slot='status-block']")).toContainText("Empty");
  });

  test("Hindi: a duplicate name is refused in Hindi, never in the server's English", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
    await open(page, { width: 390, path: "/today" });
    const item = await newItem(page, { prefix: "E2E dup" });
    await page.goto("/store/items?add=true");
    const sheet = page.getByRole("dialog", { name: "स्टोर का सामान जोड़ें" });
    await sheet.getByLabel("नाम").fill(item.name);
    await sheet.getByRole("button", { name: "सामान सेव करें" }).click();
    const alert = sheet.getByRole("alert");
    await expect(alert).toHaveText("इस नाम का सामान पहले से चालू है। दूसरा नाम रखें, या वह सामान खोलें।");
    await expect(alert).not.toContainText("already");
    // A name with no letter or digit is stopped before it is sent.
    await sheet.getByLabel("नाम").fill("--");
    await sheet.getByRole("button", { name: "सामान सेव करें" }).click();
    await expect(sheet.getByText("नाम में अक्षर या अंक लिखें।")).toBeVisible();
  });

  test("the register pages with the keyboard: focus moves to the first older entry", async ({ page }) => {
    await open(page, { width: 1280, path: "/today" });
    const item = await newItem(page, { prefix: "E2E paging" });
    for (let i = 1; i <= 23; i++) {
      await trpcMutate(page, "store.receive", { itemId: item.id, qtyMilli: 1_000, clientRequestId: `page-${item.id}-${i}` });
    }
    const all = await entriesOf(page, item.id);
    expect(all).toHaveLength(23);
    // Hold the next page a moment, so the "loading" state can be checked.
    await page.route("**/trpc/store.txns**", async (route) => {
      if (route.request().url().includes(encodeURIComponent('"limit":70'))) await page.waitForTimeout(800);
      await route.continue();
    });
    await page.goto(`/store/items/${item.id}`);
    const more = page.getByRole("button", { name: "Show older entries" });
    await expect(page.getByRole("button", { name: /^Open GRN-/ })).toHaveCount(20);
    await more.focus();
    await page.keyboard.press("Enter");
    // While it loads, the button stays and keeps focus.
    await expect(more).toHaveAttribute("aria-busy", "true");
    await expect(more).toBeFocused();
    // Then focus lands on the first older entry (newest first: the 21st row).
    await expect(page.getByRole("button", { name: `Open ${all[20]!.number}` })).toBeFocused();
    await expect(page.getByRole("button", { name: /^Open GRN-/ })).toHaveCount(23);
    await expect(more).toHaveCount(0);
    await page.unrouteAll({ behavior: "ignoreErrors" });
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
      // Entry pages do not promise them a view of the store, and offer no store guide.
      await page.goto("/store/issue");
      await expect(page.getByText("The store is for the storekeeper")).toBeVisible();
      await expect(page.getByText("You can still see what is in the store.")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /How to/ })).toHaveCount(0);
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
    await page.unrouteAll({ behavior: "ignoreErrors" });
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
    // Visual order: the "Not in the list? Add item" link sits under the picker.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Add item" })).toBeFocused();
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
  // Six pages and two sheets, each with layout guards and axe: well past the 30 s default under load.
  test.describe.configure({ timeout: 180_000 });

  for (const width of [375, 390, 820, 1280, 1440]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`store pages at ${width}px (${scheme}): no sideways scroll, nothing clipped, axe clean`, async ({ page }) => {
        await open(page, { width, scheme, path: "/today" });
        const ids = await ensureDemoStore(page);
        const pages = [
          { path: "/store", ready: page.getByRole("heading", { level: 2, name: "In the store" }) },
          { path: "/store/items", ready: page.getByRole("link", { name: "Cover flux" }) },
          {
            path: `/store/items/${ids["Roller bearing 6205"]}`,
            ready: page.getByRole("button", { name: /^Open MRS-/ }),
          },
          { path: `/store/issue?item=${ids["Cover flux"]}`, ready: page.getByText("In store now").filter({ visible: true }) },
          { path: "/store/receive", ready: page.getByRole("combobox", { name: "Item" }) },
          { path: `/store/exchange?item=${ids["Roller bearing 6205"]}`, ready: page.getByLabel("Old going out") },
        ];
        for (const p of pages) {
          await page.goto(p.path);
          await expect(p.ready.first()).toBeVisible();
          await page.waitForLoadState("networkidle");
          await expectNoHorizontalScroll(page);
          await expectNoClippedText(page, "main#main");
          expect(await blockingAxeViolations(page), p.path).toEqual([]);
        }
        // Sheets: an entry and the item editor (bottom sheet on phones, side sheet from 768px).
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

  test("success block pops when motion is allowed", async ({ page }) => {
    await open(page, { path: "/today" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const item = await newItem(page, { prefix: "E2E pop" });
    await page.goto(`/store/receive?item=${item.id}`);
    await page.getByLabel("Quantity").fill("1");
    await page.getByRole("button", { name: "Receive", exact: true }).click();
    const block = page.locator("[data-slot='status-block']");
    await expect(block).toBeVisible();
    expect(await block.evaluate((el) => getComputedStyle(el).animationName)).toBe("orrn-pop");
  });
});

/**
 * Screenshots for review (not assertions): every store screen at 375 and 1280, light and dark.
 * Run with STORE_SHOTS_DIR=<dir> to write them.
 */
test.describe("screenshots", () => {
  test.describe.configure({ timeout: 180_000 });
  const dir = process.env.STORE_SHOTS_DIR;
  test.skip(!dir, "set STORE_SHOTS_DIR to capture screenshots");
  for (const width of [375, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`capture at ${width} ${scheme}`, async ({ page }) => {
        mkdirSync(dir!, { recursive: true });
        // Scroll to the top first: a full-page capture taken while scrolled draws the fixed
        // phone header at the scroll offset, mid-page.
        const shot = async (name: string) => {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: join(dir!, `${name}-${width}-${scheme}.png`), fullPage: true });
        };
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

        await page.goto(`/store/issue?item=${ids["Graphite paste"]}`);
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
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(dir!, "store-issue-hi-375-light.png"), fullPage: true });
    await page.goto(`/store/exchange?item=${ids["Roller bearing 6205"]}`);
    await expect(page.getByRole("heading", { level: 1, name: "पुराना देकर नया लें" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    // The viewport, not the full page: how the pair sits against the sticky bar on a real phone.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: join(dir!, "store-exchange-hi-375-light.png") });
  });
});
