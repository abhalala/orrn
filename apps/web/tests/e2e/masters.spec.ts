import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

import { test } from "./helpers/test";
import { expectNoHorizontalScroll } from "../helpers/layout-guards";
import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * Masters (PL-W1): the hub, locations, vendors (+ merge), scrap items, die copies, and the
 * store items entry (the list itself lives on the Store screens, PL-W6). Each list is opened and
 * one entry is added at phone, iPad and laptop width; archive and merge run once at laptop width.
 * Every name carries a per-run suffix, so reruns against the same local D1 never collide.
 */

const WIDTHS = [375, 820, 1280] as const;
const run = Date.now().toString(36).slice(-5).toUpperCase();

async function open(page: Page, path: string, width: number, role: LocalRole = "owner") {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto(path);
  await expect(page.locator("[data-slot='app-shell']")).toBeVisible();
  await expect(page.locator("main#main h1").first()).toBeVisible();
}

async function trpcMutation<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.context().request.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
  expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).result.data as T;
}

/**
 * Retire a location this spec made. The e2e run shares one seeded database, and an active
 * "E2E-…" yard sorts ahead of Y1 in Pack's yard picker, which pack.spec drives by keyboard.
 */
async function retireLocation(page: Page, code: string) {
  const res = await page
    .context()
    .request.get(`${API_URL}/trpc/stock.locations.list?input=${encodeURIComponent(JSON.stringify({}))}`, { headers: { origin: WEB_ORIGIN } });
  expect(res.ok(), `stock.locations.list returned ${res.status()}`).toBe(true);
  const { items } = (await res.json()).result.data as { items: { id: string; code: string }[] };
  const row = items.find((l) => l.code === code);
  expect(row, `location ${code}`).toBeDefined();
  await trpcMutation(page, "stock.locations.update", { id: row!.id, active: false });
}

async function expectCleanLayout(page: Page) {
  await expectNoHorizontalScroll(page);
  const axe = await new AxeBuilder({ page }).include("main#main").analyze();
  const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** The open add/edit sheet. */
const sheet = (page: Page) => page.getByRole("dialog");

/** A row (phone cards or laptop table) that shows `text`. */
const rowWith = (page: Page, text: string) => page.locator("main#main").getByText(text, { exact: true }).first();

for (const width of WIDTHS) {
  test.describe(`masters at ${width}px`, () => {
    test("hub lists every master with its count and links", async ({ page }) => {
      await open(page, "/masters", width);
      await expect(page.getByRole("heading", { level: 1, name: "Masters" })).toBeVisible();
      // The rows of the two lists (the amber "Vendors to confirm" block is a link too, shown only while drafts exist).
      const entry = (name: string) => page.getByRole("listitem").getByRole("link", { name: new RegExp(`^${name}`) });
      for (const name of ["Vendors", "Scrap and returns", "Store items", "Locations", "Sections", "Die copies", "Reason codes"]) {
        await expect(entry(name)).toBeVisible();
      }
      // Store items are kept on the Store screens (one page, PL-W6), sections on /dies.
      await expect(entry("Store items")).toHaveAttribute("href", "/store/items");
      await expect(entry("Sections")).toHaveAttribute("href", "/dies");
      await expect(entry("Die copies")).toHaveAttribute("href", "/masters/dies");
      await expect(entry("Reason codes")).toHaveAttribute("href", "/masters/reasons");
      await expectCleanLayout(page);
    });

    test("locations: list and add one", async ({ page }) => {
      const code = `E2E-${width}-${run}`;
      await open(page, "/masters/locations", width);
      await expect(page.getByRole("heading", { level: 1, name: "Locations" })).toBeVisible();
      await expect(rowWith(page, "Y1")).toBeVisible();
      await expectCleanLayout(page);

      await page.getByRole("button", { name: "Add location" }).first().click();
      const s = sheet(page);
      await expect(s).toBeVisible();
      // Empty save names both missing fields.
      await s.getByRole("button", { name: "Save location" }).click();
      await expect(s.getByText("Give the location a code.")).toBeVisible();
      await s.getByLabel("Code").fill(code);
      await s.getByLabel("Name").fill(`E2E yard ${width}`);
      await s.getByRole("button", { name: "Save location" }).click();
      await expect(s).toBeHidden();
      await expect(rowWith(page, code)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await retireLocation(page, code);
    });

    test("reason codes: add with Hindi wording, rename, retire and bring back; Other is fixed", async ({ page }) => {
      const label = `E2E reprint ${width} ${run}`;
      const renamed = `${label} renamed`;
      await open(page, "/masters/reasons?kind=reprint", width);
      await expect(page.getByRole("heading", { level: 1, name: "Reason codes" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Reprint", selected: true })).toBeVisible();
      // The standard codes are there, and Other is listed last, marked fixed, with no edit button.
      await expect(rowWith(page, "Label damaged")).toBeVisible();
      await expect(page.getByRole("button", { name: "Edit Other" })).toHaveCount(0);
      await expect(page.locator("main#main").getByText("Fixed").first()).toBeVisible();
      await expectCleanLayout(page);

      await page.getByRole("button", { name: "Add reason" }).first().click();
      const s = sheet(page);
      await expect(s).toBeVisible();
      await s.getByRole("button", { name: "Save reason" }).click();
      await expect(s.getByText("Give the wording.")).toBeVisible();
      await s.getByLabel("English wording").fill(label);
      await s.getByLabel("Hindi wording").fill("धुंधला लेबल");
      await s.getByRole("button", { name: "Save reason" }).click();
      await expect(s).toBeHidden();
      await expect(rowWith(page, label)).toBeVisible();
      await expect(rowWith(page, "धुंधला लेबल")).toBeVisible();
      await expectNoHorizontalScroll(page);

      // Rename keeps the key; the Hindi wording stays.
      await page.getByRole("button", { name: `Edit ${label}` }).click();
      await s.getByLabel("English wording").fill(renamed);
      await s.getByRole("button", { name: "Save reason" }).click();
      await expect(s).toBeHidden();
      await expect(rowWith(page, renamed)).toBeVisible();

      // Retire: it leaves the in-use list and shows under Retired; bring it back.
      await page.getByRole("button", { name: `Edit ${renamed}` }).click();
      await s.getByRole("button", { name: "Retire" }).click();
      await expect(s).toBeHidden();
      await expect(rowWith(page, renamed)).toHaveCount(0);
      await page.getByRole("radio", { name: "Retired" }).click();
      await expect(rowWith(page, renamed)).toBeVisible();
      await page.getByRole("button", { name: `Edit ${renamed}` }).click();
      await s.getByRole("button", { name: "Bring back" }).click();
      await expect(s).toBeHidden();
      await page.getByRole("radio", { name: "In use" }).click();
      await expect(rowWith(page, renamed)).toBeVisible();

      // Leave the shared plant as found: retire what this spec added.
      await page.getByRole("button", { name: `Edit ${renamed}` }).click();
      await s.getByRole("button", { name: "Retire" }).click();
      await expect(s).toBeHidden();
    });

    test("reason codes: a role without masters.publish reads the list and has no add or edit", async ({ page }) => {
      await open(page, "/masters/reasons", width, "operator");
      await expect(page.getByRole("heading", { level: 1, name: "Reason codes" })).toBeVisible();
      await expect(rowWith(page, "Die change")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add reason" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Edit Die change" })).toHaveCount(0);
    });

    test("vendors: list and add one", async ({ page }) => {
      const name = `E2E Vendor ${width} ${run}`;
      await open(page, "/vendors", width);
      await expect(page.getByRole("heading", { level: 1, name: "Vendors" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Merge vendors" })).toBeVisible();
      await expectCleanLayout(page);

      await page.getByRole("button", { name: "Add vendor" }).first().click();
      const s = sheet(page);
      await s.getByLabel("GSTIN").fill("NOT-A-GSTIN");
      await s.getByRole("button", { name: "Save vendor" }).click();
      await expect(s.getByText("Give the vendor a name.")).toBeVisible();
      await expect(s.getByText(/That isn't a valid GSTIN/)).toBeVisible();
      await s.getByLabel("Name").fill(name);
      await s.getByLabel("GSTIN").fill("");
      await s.getByLabel("City").fill("Rajkot");
      await s.getByRole("button", { name: "Save vendor" }).click();
      await expect(s).toBeHidden();
      // A new vendor opens on its own page; the list then finds it by name.
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect(page).toHaveURL(/\/vendors\/[^/?]+$/);
      await expectNoHorizontalScroll(page);
      await page.goto(`/vendors?q=${encodeURIComponent(name)}`);
      await expect(rowWith(page, name)).toBeVisible();
      await expectNoHorizontalScroll(page);
    });

    test("scrap items: list and add one", async ({ page }) => {
      const name = `E2E SCRAP ${width} ${run}`;
      await open(page, "/masters/scrap", width);
      await expect(page.getByRole("heading", { level: 1, name: "Scrap and returns" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Scrap items" })).toHaveAttribute("aria-selected", "true");
      await expectCleanLayout(page);

      await page.getByRole("button", { name: "Add scrap item" }).first().click();
      const s = sheet(page);
      await s.getByLabel("Expected recovery (%)").fill("120");
      await s.getByRole("button", { name: "Save" }).click();
      await expect(s.getByText("Give it a name.")).toBeVisible();
      await s.getByLabel("Name").fill(name);
      await s.getByLabel("Expected recovery (%)").fill("88.5");
      await s.getByRole("button", { name: "Save" }).click();
      await expect(s).toBeHidden();
      await expect(rowWith(page, name)).toBeVisible();
      await expect(rowWith(page, "88.5%").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    });

    test("die copies: list and add a copy of a section", async ({ page }) => {
      await open(page, "/masters/dies", width);
      await expect(page.getByRole("heading", { level: 1, name: "Die copies" })).toBeVisible();
      await expectCleanLayout(page);

      await page.getByRole("button", { name: "Add die copy" }).first().click();
      const s = sheet(page);
      await s.getByRole("button", { name: "Save die copy" }).click();
      await expect(s.getByText("Choose the section this die makes.")).toBeVisible();
      const combo = s.getByRole("combobox", { name: "Section" });
      await combo.fill("15310");
      await page.getByRole("option", { name: /15310/ }).first().click();
      await s.getByLabel("Supplier").fill(`E2E supplier ${run}`);
      await s.getByLabel("Trial kg/12ft").fill("2.7");
      await s.getByRole("button", { name: "Save die copy" }).click();
      await expect(s).toBeHidden();
      // The code is the section code and the next copy number, allocated by the server.
      const toast = page.getByText(/^Die copy 15310-\d+ added$/);
      await expect(toast).toBeVisible();
      const code = (await toast.textContent())!.match(/15310-\d+/)![0];
      await expect(rowWith(page, code)).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
}

test.describe("masters at 1280px: archive, merge, roles", () => {
  test("a location is retired from its sheet, not deleted, and comes back", async ({ page }) => {
    const code = `E2E-R-${run}`;
    await open(page, "/masters/locations", 1280);
    await trpcMutation(page, "stock.locations.create", { code, name: "E2E retire", kind: "yard" });
    await page.reload();
    await page.getByRole("button", { name: `Edit ${code}` }).click();
    const s = sheet(page);
    await s.getByRole("button", { name: "Retire location" }).click();
    await expect(page.getByText(`${code} retired`)).toBeVisible();
    await page.getByRole("radio", { name: "Retired" }).click();
    await expect(rowWith(page, code)).toBeVisible();
    await page.getByRole("button", { name: `Edit ${code}` }).click();
    await sheet(page).getByRole("button", { name: "Bring back" }).click();
    await expect(page.getByText(`${code} is back in use`)).toBeVisible();
    await retireLocation(page, code);
  });

  test("a vendor is archived from its page and brought back", async ({ page }) => {
    const name = `E2E Archive ${run}`;
    await open(page, "/vendors", 1280);
    const v = await trpcMutation<{ id: string }>(page, "vendor.create", { name, city: "Morbi" });
    await page.goto(`/vendors/${v.id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.getByRole("button", { name: "Archive vendor" }).click();
    await expect(page.getByText(`${name} archived`)).toBeVisible();
    await expect(page.getByText("Archived. It no longer shows when the yard picks a vendor.")).toBeVisible();
    await page.getByRole("button", { name: "Bring back" }).click();
    await expect(page.getByText(`${name} is back in use`)).toBeVisible();
  });

  test("duplicate vendors merge into the one kept, after a confirm", async ({ page }) => {
    const keepName = `E2E Keeper ${run}`;
    const dupName = `E2E Keepr ${run}`;
    await open(page, "/vendors", 1280);
    const keep = await trpcMutation<{ id: string }>(page, "vendor.create", { name: keepName });
    const dup = await trpcMutation<{ id: string }>(page, "vendor.create", { name: dupName });
    await page.goto(`/vendors/${keep.id}`);
    await page.getByRole("button", { name: "Merge duplicates into this vendor" }).click();
    const s = sheet(page);
    await expect(s.getByRole("heading", { name: `Merge into ${keepName}` })).toBeVisible();
    await s.getByRole("searchbox").fill(dupName);
    await s.getByRole("checkbox", { name: new RegExp(dupName) }).check();
    await expect(s.getByText("1 duplicate picked")).toBeVisible();
    await s.getByRole("button", { name: "Merge 1" }).click();
    const confirm = page.getByRole("dialog", { name: `Merge 1 vendor into ${keepName}?` });
    await expect(confirm.getByText("This can't be undone.", { exact: false })).toBeVisible();
    await confirm.getByRole("button", { name: "Merge", exact: true }).click();
    await expect(page.getByText(`Merged into ${keepName}.`, { exact: false })).toBeVisible();
    // The duplicate's name is now one of the keeper's spellings; its own page says where it went.
    await expect(page.locator("main#main").getByText(dupName).first()).toBeVisible();
    await page.goto(`/vendors/${dup.id}`);
    await expect(page.getByText(`Merged into ${keepName}.`, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit vendor" })).toHaveCount(0);
  });

  test("a viewer reads the lists but gets no add, edit or merge controls", async ({ page }) => {
    await open(page, "/masters/locations", 1280, "viewer");
    await expect(page.getByText("Only a manager or the owner can change this list.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add location" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);

    await page.goto("/masters/dies");
    await expect(page.getByRole("heading", { level: 1, name: "Die copies" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add die copy" })).toHaveCount(0);

    await page.goto("/masters/scrap");
    await expect(page.getByRole("heading", { level: 1, name: "Scrap and returns" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add scrap item" })).toHaveCount(0);
  });

  test("the office reads vendors but cannot add, merge or edit them", async ({ page }) => {
    await open(page, "/vendors", 1280, "office");
    await expect(page.getByRole("heading", { level: 1, name: "Vendors" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add vendor" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Merge vendors" })).toHaveCount(0);
  });
});
