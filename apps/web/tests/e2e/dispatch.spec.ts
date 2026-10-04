import { mkdirSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Dispatch (Task 22): list, new, Build -> Hold -> Dispatch, packing list.
 *
 * The main flow packs its own fresh bundles through the API first, so no
 * other spec running at the same time can take them. Seeded dispatches
 * (`dev-dispatch-*`) are only read, never changed.
 */

type Scheme = "light" | "dark";

const kgText = (kg: number, digits = 2) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(kg);

async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page
    .context()
    .request.get(`${API_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: WEB_ORIGIN } });
  expect(res.ok(), `${path} returned ${res.status()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function trpcMutation<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

async function start(page: Page, role: LocalRole, opts: { width?: number; height?: number; scheme?: Scheme } = {}) {
  await page.setViewportSize({ width: opts.width ?? 1280, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
}

/** Packs `count` new bundles through the API (owner), so this test alone owns them. */
async function packFresh(page: Page, count: number) {
  const dies = await trpcQuery<{ items: { id: string }[] }>(page, "die.list", { limit: 1 });
  const locations = await trpcQuery<{ items: { id: string; kind: string }[] }>(page, "stock.locations.list", {});
  const yard = locations.items.find((l) => l.kind === "yard");
  const rows = Array.from({ length: count }, (_, i) => ({ quantity: 20 + (i % 3), weightG: 50_000 + i * 137, lengthMm: 3658 }));
  const receipt = await trpcMutation<{ groupId: string }>(page, "bundle.createReceipt", {
    dieId: dies.items[0]!.id,
    unit: "inch",
    ...(yard ? { locationId: yard.id } : {}),
    rows,
  });
  const list = await trpcQuery<{ items: { serial: string; weightG: number }[] }>(page, "bundle.listBundles", {
    groupId: receipt.groupId,
    limit: 100,
  });
  expect(list.items).toHaveLength(count);
  return list.items;
}

async function firstCustomer(page: Page) {
  const res = await trpcQuery<{ items: { id: string; name: string }[] }>(page, "customer.list", { limit: 1 });
  return res.items[0]!;
}

async function newDispatch(page: Page) {
  const customer = await firstCustomer(page);
  return trpcMutation<{ id: string; code: string }>(page, "dispatch.create", { customerId: customer.id });
}

const hero = (page: Page) => page.locator("[data-slot='dispatch-hero']");

async function pasteSerials(page: Page, serials: string[]) {
  await page.getByRole("button", { name: "Paste serials" }).click();
  const sheet = page.getByRole("dialog", { name: "Paste serials" });
  await sheet.getByLabel("Serials").fill(serials.join("\n"));
  await sheet.getByRole("button", { name: "Add bundles" }).click();
  await expect(sheet.getByText("What happened")).toBeVisible();
  return sheet;
}

test.describe("dispatch: build, hold, dispatch, packing list", () => {
  test("new dispatch, paste 10 serials, hold, dispatch: the packing list has 10 rows and the kg total", async ({ page }) => {
    await start(page, "owner");
    const bundles = await packFresh(page, 10);
    const customer = await firstCustomer(page);
    const totalKg = bundles.reduce((s, b) => s + b.weightG, 0) / 1000;

    await page.goto("/dispatch/new");
    await expect(page.getByRole("heading", { level: 1, name: "New dispatch" })).toBeVisible();
    const combo = page.getByRole("combobox", { name: "Customer" });
    await combo.fill(customer.name.slice(0, 6));
    await page.getByRole("option", { name: customer.name }).first().click();
    await page.getByRole("button", { name: "Create dispatch" }).click();

    await expect(page).toHaveURL(/\/dispatch\/[^/]+$/);
    await expect(hero(page)).toHaveAttribute("data-status", "draft");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^DSP-\d+$/);
    await expect(hero(page)).toContainText(customer.name);

    const sheet = await pasteSerials(
      page,
      bundles.map((b) => b.serial),
    );
    await expect(sheet).toContainText("10 added");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("dispatch-bundles")).toHaveText("10");

    await page.getByRole("button", { name: "Hold stock" }).click();
    await expect(hero(page)).toHaveAttribute("data-status", "reserved");
    await expect(page.getByText("Bundles you add now are held straight away.")).toBeVisible();
    // The "Stock held" toast rises above the sticky bar instead of covering Dispatch.
    const toastBox = await page.locator("[data-sonner-toast]").filter({ hasText: "Stock held" }).boundingBox();
    const barBox = await page.locator("[data-slot='dispatch-action-bar']").boundingBox();
    expect(toastBox && barBox && toastBox.y + toastBox.height <= barBox.y + 1).toBe(true);

    await page.getByRole("button", { name: "Dispatch", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: /^Dispatch DSP-/ });
    await expect(confirm).toContainText(`10 bundles · ${kgText(totalKg, 1)} kg`);
    await confirm.getByTestId("confirm-dispatch").click();

    await expect(hero(page)).toHaveAttribute("data-status", "completed");
    await expect(page.getByRole("heading", { level: 2, name: "Packing list" })).toBeVisible();
    await expect(page.getByTestId("packing-list-row")).toHaveCount(10);
    await expect(page.getByTestId("packing-list-totals")).toHaveText(`10 bundles · ${kgText(totalKg)} kg`);
    await expect(page.getByTestId("packing-list-total-kg")).toHaveText(kgText(totalKg));
    // Never the packing session id as a group.
    await expect(page.getByTestId("packing-list-table")).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test("pasting serials already on the dispatch reports them as already in this dispatch", async ({ page }) => {
    await start(page, "owner", { width: 390, height: 844 });
    const bundles = await packFresh(page, 3);
    const d = await newDispatch(page);
    await page.goto(`/dispatch/${d.id}`);
    await expect(hero(page)).toBeVisible();

    let sheet = await pasteSerials(page, [bundles[0]!.serial, bundles[1]!.serial]);
    await expect(sheet).toContainText("2 added");
    await sheet.getByRole("button", { name: "Paste more" }).click();
    await sheet.getByLabel("Serials").fill([bundles[0]!.serial, bundles[1]!.serial, bundles[2]!.serial, "NOPE-404"].join(", "));
    await sheet.getByRole("button", { name: "Add bundles" }).click();
    await expect(sheet.getByText("What happened")).toBeVisible();
    await expect(sheet).toContainText("1 added");
    await expect(sheet).toContainText("2 already in this dispatch");
    await expect(sheet).toContainText("1 not found");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("dispatch-bundles")).toHaveText("3");
  });

  test("a bundle held by another dispatch is refused with the holding code", async ({ page }) => {
    await start(page, "owner");
    const [b] = await packFresh(page, 1);
    const other = await newDispatch(page);
    await trpcMutation(page, "dispatch.addBundlesBySerial", { id: other.id, serials: [b!.serial] });
    await trpcMutation(page, "dispatch.reserve", { id: other.id });
    const d = await newDispatch(page);
    await page.goto(`/dispatch/${d.id}`);
    const sheet = await pasteSerials(page, [b!.serial]);
    await expect(sheet).toContainText("1 not available");
    await expect(sheet).toContainText(`Held for ${other.code}`);
  });

  test("scanning the same bundle twice during Build is calm and adds it once", async ({ page }) => {
    await start(page, "owner");
    const [b] = await packFresh(page, 1);
    const d = await newDispatch(page);
    await page.goto(`/dispatch/${d.id}`);
    await page.getByRole("button", { name: "Scan bundles" }).click();
    const sheet = page.getByRole("dialog", { name: `Scanning into ${d.code}` });
    const field = sheet.getByLabel("Serial or label link");
    await field.fill(b!.serial);
    await field.press("Enter");
    await expect(sheet.getByRole("status").filter({ hasText: `Added ${b!.serial}` })).toBeVisible();
    await field.fill(b!.serial);
    await field.press("Enter");
    await expect(sheet.getByRole("status").filter({ hasText: "Already in this dispatch" })).toBeVisible();
    await sheet.getByRole("button", { name: "Done scanning" }).click();
    await expect(page.getByTestId("dispatch-bundles")).toHaveText("1");
    await expect(page.locator(`[data-serial='${b!.serial}']`)).toHaveCount(1);
  });

  test("removing a bundle offers undo", async ({ page }) => {
    await start(page, "owner");
    const bundles = await packFresh(page, 2);
    const d = await newDispatch(page);
    await trpcMutation(page, "dispatch.addBundlesBySerial", { id: d.id, serials: bundles.map((b) => b.serial) });
    await page.goto(`/dispatch/${d.id}`);
    await expect(page.getByTestId("dispatch-bundles")).toHaveText("2");
    await page.getByRole("button", { name: `Remove ${bundles[0]!.serial}` }).click();
    await expect(page.getByTestId("dispatch-bundles")).toHaveText("1");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("dispatch-bundles")).toHaveText("2");
  });

  test("a packing group label groups bundles on the dispatch", async ({ page }) => {
    await start(page, "owner");
    const bundles = await packFresh(page, 2);
    const d = await newDispatch(page);
    await trpcMutation(page, "dispatch.addBundlesBySerial", { id: d.id, serials: bundles.map((b) => b.serial) });
    await page.goto(`/dispatch/${d.id}`);
    await page.getByRole("button", { name: /^Set label/ }).click();
    const sheet = page.getByRole("dialog", { name: /^Packing group label for/ });
    await sheet.getByLabel("Packing group label").fill("a");
    await sheet.getByRole("button", { name: "Save label" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("heading", { level: 3, name: "Group A" })).toBeVisible();
  });
});

test.describe("dispatch: roles", () => {
  test("a viewer sees dispatches but no button that changes them", async ({ page }) => {
    await start(page, "viewer");
    for (const id of ["dev-dispatch-draft", "dev-dispatch-held"]) {
      await page.goto(`/dispatch/${id}`);
      await expect(hero(page)).toBeVisible();
      await expect(page.getByText("You can see this dispatch. Changes are made by the office.")).toBeVisible();
      for (const name of ["Scan bundles", "Paste serials", "Search to add", "Hold stock", "Release", "More actions", /^Remove /, /^Set label/]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
      await expect(page.getByRole("button", { name: "Dispatch", exact: true })).toHaveCount(0);
    }
    await page.goto("/dispatch/dev-dispatch-done-1");
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
    await page.goto("/dispatch");
    await expect(page.getByRole("link", { name: "New dispatch" })).toHaveCount(0);
  });

  test("an operator can scan into a dispatch but cannot hold or dispatch it", async ({ page }) => {
    await start(page, "operator");
    await page.goto("/dispatch/dev-dispatch-draft");
    await expect(hero(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Scan bundles" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hold stock" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Dispatch", exact: true })).toHaveCount(0);
  });

  test("the monthly volume chart is for analytics roles only", async ({ page }) => {
    await start(page, "owner");
    await page.goto("/dispatch");
    await expect(page.getByTestId("dispatch-volume")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dispatch volume" })).toBeVisible();

    await page.context().clearCookies();
    await signInViaApi(page, "operator");
    const chartRequests: string[] = [];
    page.on("request", (r) => {
      if (/dispatchVolume|volume-chart/.test(r.url())) chartRequests.push(r.url());
    });
    await page.goto("/dispatch");
    await expect(page.getByRole("heading", { level: 1, name: "Dispatch" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("dispatch-volume")).toHaveCount(0);
    expect(chartRequests).toEqual([]);
  });
});

test.describe("dispatch: packing list exports", () => {
  const HEAVY = /react-pdf|packingListPdf/i;

  test("Download PDF triggers a download and loads the PDF renderer only then", async ({ page }) => {
    await start(page, "owner");
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto("/dispatch/dev-dispatch-done-1");
    await expect(page.getByTestId("packing-list-row").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(urls.filter((u) => HEAVY.test(u))).toEqual([]);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    expect(urls.some((u) => HEAVY.test(u))).toBe(true);
  });

  test("Download Excel triggers an .xlsx download", async ({ page }) => {
    await start(page, "owner");
    await page.goto("/dispatch/dev-dispatch-done-1");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download Excel" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });
});

test.describe("dispatch: list", () => {
  test("status tabs filter the list and keep the choice in the URL", async ({ page }) => {
    await start(page, "owner");
    await page.goto("/dispatch");
    await expect(page.getByRole("radio", { name: "Building" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: "Dispatched" }).click();
    await expect(page).toHaveURL(/status=completed/);
    await expect(page.getByRole("table", { name: "Dispatches" }).getByText("Dispatched").first()).toBeVisible();
    await page.getByRole("link", { name: /DSP-/ }).first().click();
    await expect(hero(page)).toHaveAttribute("data-status", "completed");
  });

  test("the old /dispatches URL lands on /dispatch with its query", async ({ page }) => {
    await start(page, "owner");
    await page.goto("/dispatches?status=reserved");
    await expect(page).toHaveURL(/\/dispatch\?status=reserved$/);
    await expect(page.getByRole("radio", { name: "Held" })).toHaveAttribute("aria-checked", "true");
  });
});

const SCREENS = [
  { name: "list", path: "/dispatch", ready: (p: Page) => p.getByRole("heading", { level: 1, name: "Dispatch" }) },
  { name: "new", path: "/dispatch/new", ready: (p: Page) => p.getByRole("heading", { level: 1, name: "New dispatch" }) },
  { name: "build", path: "/dispatch/dev-dispatch-draft", ready: (p: Page) => hero(p) },
  { name: "held", path: "/dispatch/dev-dispatch-held", ready: (p: Page) => hero(p) },
  { name: "packing-list", path: "/dispatch/dev-dispatch-done-1", ready: (p: Page) => p.getByTestId("packing-list-row").first() },
];

test.describe("dispatch: accessibility and layout", () => {
  for (const width of [390, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`no serious axe violations, no sideways scroll, nothing clipped at ${width} ${scheme}`, async ({ page }) => {
        await start(page, "owner", { width, height: width < 768 ? 844 : 900, scheme });
        for (const s of SCREENS) {
          await page.goto(s.path);
          await expect(s.ready(page)).toBeVisible();
          await page.waitForLoadState("networkidle");
          await expectNoHorizontalScroll(page);
          await expectNoClippedText(page);
          const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
          const bad = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          expect(bad.map((v) => `${s.name}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
        }
      });
    }
  }
});

test.describe("dispatch: Hindi on a phone", () => {
  test("longer Hindi labels wrap instead of clipping, with no sideways scroll at 375", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("orrn.locale", "hi"));
    await start(page, "owner", { width: 375, height: 812 });
    for (const s of SCREENS) {
      await page.goto(s.path);
      // Headings are in Hindi now; wait on the structure, not the English text.
      await expect(s.name === "list" || s.name === "new" ? page.getByRole("heading", { level: 1 }) : s.ready(page)).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("lang", "hi");
      await expectNoHorizontalScroll(page);
      await expectNoClippedText(page);
      if (process.env.T22_SHOTS) await page.screenshot({ path: `${process.env.T22_SHOTS}/${s.name}-375-light-hi.png`, fullPage: true });
    }
  });
});

/** Review screenshots (T22_SHOTS=<dir>): every screen at 375 and 1280, light and dark. */
test.describe("dispatch: screenshots", () => {
  test.skip(!process.env.T22_SHOTS, "set T22_SHOTS to a folder to capture review screenshots");
  for (const width of [375, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`capture ${width} ${scheme}`, async ({ page }) => {
        const dir = process.env.T22_SHOTS!;
        mkdirSync(dir, { recursive: true });
        await start(page, "owner", { width, height: width < 768 ? 812 : 900, scheme });
        for (const s of SCREENS) {
          await page.goto(s.path);
          await expect(s.ready(page)).toBeVisible();
          await page.waitForLoadState("networkidle");
          await page.screenshot({ path: `${dir}/${s.name}-${width}-${scheme}.png`, fullPage: true });
          // A phone's first view as it really looks (fixed tab bar and sticky action bar in place).
          if (width < 768) await page.screenshot({ path: `${dir}/${s.name}-${width}-${scheme}-top.png` });
        }
        // The paste report on the draft (read only: nothing is sent for an empty paste).
        await page.goto("/dispatch/dev-dispatch-draft");
        await page.getByRole("button", { name: "Paste serials" }).click();
        await page.getByRole("dialog", { name: "Paste serials" }).getByLabel("Serials").fill("26I0001\n26I0002, 26I0003");
        await page.screenshot({ path: `${dir}/paste-${width}-${scheme}.png` });
      });
    }
  }
});
