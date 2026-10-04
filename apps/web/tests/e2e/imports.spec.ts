import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import * as XLSX from "xlsx";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Settings → Data and the import sheet (Task 25, audit W1/W10). The seeded
 * demo company measures in inches, which is exactly the Review Focus 4 case:
 * a mm sheet must land as 3658 mm, never 25.4 times off. One test saves for
 * real and reads the bundle back; the chunking and retry tests answer the
 * import calls in the browser so they don't fill the local database.
 *
 * Screenshots for review: set T25_SHOTS_DIR to write them.
 */

type Scheme = "light" | "dark";

async function open(page: Page, opts: { width: number; scheme?: Scheme; role?: LocalRole; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  await page.goto("/settings?tab=data");
  // A worker's first page pulls every module cold from Vite dev; on a loaded machine that alone
  // takes longer than the 5 s default (blank "Loading" page, no h1), so the first paint gets 20 s.
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 20_000 });
}

function csv(rows: (string | number)[][]): Buffer {
  return Buffer.from(rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n"));
}

function xlsx(rows: (string | number)[][]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Stock");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function openImport(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  return sheet;
}

async function chooseFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.locator("[data-slot='import-sheet'] input[type='file']").setInputFiles(file);
}

function stage(page: Page) {
  return page.locator("[data-slot='import-sheet']");
}

async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page
    .context()
    .request.get(`${API_URL}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { origin: WEB_ORIGIN } });
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

/** Answers one tRPC procedure in the browser (batched or not) and records every input it was sent. */
async function answer(
  page: Page,
  procedure: string,
  reply: (input: unknown, call: number) => { data: unknown } | { error: string; status: number },
) {
  const inputs: unknown[] = [];
  await page.route(`**/trpc/${procedure}**`, async (route: Route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const url = new URL(req.url());
    const batched = url.searchParams.get("batch") === "1";
    const body = req.postDataJSON() as Record<string, unknown>;
    const input = batched ? body["0"] : body;
    inputs.push(input);
    const out = reply(input, inputs.length - 1);
    const entry =
      "data" in out
        ? { result: { data: out.data } }
        : { error: { message: out.error, code: -32600, data: { code: "BAD_REQUEST", httpStatus: out.status } } };
    await route.fulfill({
      status: "data" in out ? 200 : out.status,
      contentType: "application/json",
      body: JSON.stringify(batched ? [entry] : entry),
    });
  });
  return inputs;
}

const BUNDLE_HEADERS = ["Die series", "Section code", "Pieces", "Weight (kg)", "Length (mm)", "PO number"];

test.describe("Data tab", () => {
  test("owner sees the three imports with one labelled button each", async ({ page }) => {
    await open(page, { width: 1280 });
    const tab = page.locator("[data-slot='data-tab']");
    await expect(tab.getByRole("heading", { level: 2 })).toHaveText(["Import old bundles", "Import dies", "Import customers"]);
    await expect(page.getByRole("button", { name: "Choose file Import old bundles" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose file Import dies" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose file Import customers" })).toBeVisible();
  });

  test("an operator is told their role can't import", async ({ page }) => {
    await open(page, { width: 390, role: "operator" });
    await expect(page.getByText("Your role can't import data.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Choose file/ })).toHaveCount(0);
  });

  for (const width of [390, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`no serious a11y issues and no clipping at ${width} ${scheme}`, async ({ page }) => {
        await open(page, { width, scheme });
        await expect(page.locator("[data-slot='data-tab'] li")).toHaveCount(3);
        expect(await blockingAxeViolations(page)).toEqual([]);
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page);
      });
    }
  }
});

test.describe("import sheet", () => {
  test("a mm sheet imported into the inch company stores 3658 mm (Review Focus 4)", async ({ page }) => {
    await open(page, { width: 1280 });
    const po = `E2E-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
    const sheet = await openImport(page, /Choose file Import old bundles/);
    await chooseFile(page, {
      name: "old-stock.csv",
      mimeType: "text/csv",
      buffer: csv([
        BUNDLE_HEADERS,
        ["PATTI", "14701", 25, 58.4, 3658, po],
        ["PATTI", "14701", 25, "", 3658, po],
        ["PATTI", "14701", 25, "1e3", 3658, po],
      ]),
    });
    await expect(stage(page)).toHaveAttribute("data-stage", "review");
    await expect(sheet.locator("[data-slot='status-block']").first()).toContainText("Ready to import");
    await expect(sheet.locator("[data-slot='status-block']").first()).toContainText("1");
    await expect(sheet.locator("[data-slot='status-block']").nth(1)).toContainText("Need fixing");
    // The length column is read as mm even though the company measures in inches.
    await expect(sheet.getByRole("definition").filter({ hasText: "Length in mm" })).toBeVisible();
    // The preview shows it the way this company reads lengths.
    await expect(sheet.getByText("12 ft", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Weight (kg) is empty.")).toBeVisible();
    await expect(sheet.getByText("Weight (kg) is not a plain number. Use digits only, like 45.5.")).toBeVisible();
    // One live region, mounted with the sheet, reads each stage out.
    const announce = page.locator("[data-slot='import-announce']");
    await expect(announce).toHaveAttribute("role", "status");
    await expect(announce).toHaveText("1 row ready. 2 rows with problems.");

    await sheet.getByRole("button", { name: "Import 1 row" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    await expect(sheet.locator("[data-slot='status-block']")).toContainText("Imported");
    await expect(announce).toHaveText("1 row imported");

    const saved = await trpcQuery<{ items: { lengthMm: number; weightG: number; quantity: number }[] }>(
      page,
      "bundle.listBundles",
      { search: po, limit: 10 },
    );
    expect(saved.items).toEqual([expect.objectContaining({ lengthMm: 3658, weightG: 58400, quantity: 25 })]);
  });

  test("an Excel sheet with Length (in) 144 reads as 3658 mm", async ({ page }) => {
    await open(page, { width: 1280 });
    const sheet = await openImport(page, /Choose file Import old bundles/);
    const sent = await answer(page, "bundle.bulkImport", (input) => ({
      data: { success: true, bundleCount: (input as { rows: unknown[] }).rows.length, dieCount: 1, newDies: 0, newGroups: 0, reusedGroups: 1 },
    }));
    await chooseFile(page, {
      name: "stock.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx([
        ["Die series", "Section code", "Qty", "Weight (g)", "Length (in)"],
        ["PATTI", "14701", 10, 23500, 144],
      ]),
    });
    await expect(sheet.getByRole("definition").filter({ hasText: "Length in inches" })).toBeVisible();
    // A renamed column names the field it fills; an unrenamed one just says it was used.
    const read = sheet.locator("dl > div");
    await expect(read.filter({ hasText: "Qty" }).getByRole("definition")).toHaveText("Pieces");
    await expect(read.filter({ hasText: "Die series" }).getByRole("definition")).toHaveText("Used as it is");
    await sheet.getByRole("button", { name: "Import 1 row" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    expect(sent).toEqual([{ rows: [{ dieSeries: "PATTI", dieSectionCode: "14701", quantity: 10, weightG: 23500, lengthMm: 3658, poNumber: null }] }]);
  });

  test("1,200 customers go in calls of 500; a failed call resumes without resending saved rows", async ({ page }) => {
    await open(page, { width: 1280 });
    const sheet = await openImport(page, /Choose file Import customers/);
    let failOnce = true;
    const sent = await answer(page, "customer.importCsv", (input, call) => {
      const rows = input as { name: string }[];
      if (call === 1 && failOnce) {
        failOnce = false;
        return { error: "The server is busy. Try again.", status: 400 };
      }
      return { data: { success: true, count: rows.length } };
    });
    const rows: (string | number)[][] = [["Name", "Phone"]];
    for (let i = 1; i <= 1200; i++) rows.push([`Party ${i}`, `98250 ${String(i).padStart(5, "0")}`]);
    await chooseFile(page, { name: "parties.csv", mimeType: "text/csv", buffer: csv(rows) });
    await expect(sheet.locator("[data-slot='status-block']").first()).toContainText("1,200");
    await sheet.getByRole("button", { name: "Import 1,200 rows" }).click();

    await expect(stage(page)).toHaveAttribute("data-stage", "failed");
    await expect(sheet.getByText("Saved 500 of 1,200 rows. The rest were not saved.")).toBeVisible();
    await expect(sheet.getByText("The server is busy. Try again.")).toBeVisible();
    await sheet.getByRole("button", { name: "Try the rest again" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    await expect(sheet.locator("[data-slot='status-block']")).toContainText("1,200");

    const names = sent.map((input) => (input as { name: string }[]).map((r) => r.name));
    expect(names.map((n) => n.length)).toEqual([500, 500, 500, 200]);
    // The retry starts at the failed chunk: Party 501 is sent again, Party 1 never is.
    expect(names[2]![0]).toBe("Party 501");
    expect(names.flat().filter((n) => n === "Party 1")).toHaveLength(1);
  });

  test("dies already in orrn are left alone unless the person chooses to update them", async ({ page }) => {
    await open(page, { width: 1280 });
    const sheet = await openImport(page, /Choose file Import dies/);
    const sent = await answer(page, "die.processImport", (input) => {
      const i = input as { newRows: unknown[]; updatedRows: unknown[] };
      return { data: { success: true, count: i.newRows.length + i.updatedRows.length } };
    });
    const code = `E2E${Date.now().toString(36).toUpperCase()}`;
    await chooseFile(page, {
      name: "dies.csv",
      mimeType: "text/csv",
      buffer: csv([
        ["Series", "Section code", "Name", "Min weight (kg/12ft)", "Max weight (kg/12ft)", "Width (in)"],
        ["PATTI", "14701", "Patti 1 x 1/8", 2.4, 2.6, 1],
        ["E2E", code, "New section", 1.1, 1.3, ""],
        ["E2E", code, "Repeat", 1.1, 1.3, ""],
      ]),
    });
    await expect(stage(page)).toHaveAttribute("data-stage", "review");
    await expect(sheet.getByText("1 die is already in orrn")).toBeVisible();
    await expect(sheet.getByText("Same die as row 3.")).toBeVisible();
    await sheet.getByRole("radio", { name: "Update from this sheet" }).click();
    await sheet.getByRole("button", { name: "Import 2 rows" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    const body = sent[0] as { newRows: { sectionCode: string }[]; updatedRows: { sectionCode: string; existingId: string; widthMm: number }[] };
    expect(body.newRows.map((r) => r.sectionCode)).toEqual([code]);
    expect(body.updatedRows).toEqual([expect.objectContaining({ sectionCode: "14701", widthMm: 25.4, existingId: expect.any(String) })]);
  });

  test("a sheet without a required column says which one; other files are refused", async ({ page }) => {
    await open(page, { width: 390 });
    const sheet = await openImport(page, /Choose file Import old bundles/);
    await chooseFile(page, { name: "notes.json", mimeType: "application/json", buffer: Buffer.from("[]") });
    await expect(sheet.getByRole("alert")).toHaveText("This is not a CSV or Excel file. Choose a .csv, .xlsx or .xls file.");
    await chooseFile(page, {
      name: "no-weight.csv",
      mimeType: "text/csv",
      buffer: csv([
        ["Die series", "Section code", "Pieces", "Length (mm)"],
        ["PATTI", "14701", 3, 3658],
      ]),
    });
    await expect(sheet.getByRole("alert")).toContainText("Columns missing");
    await expect(sheet.getByRole("alert")).toContainText("Weight (kg)");
    await expectNoHorizontalScroll(page);
  });

  for (const width of [390, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`review stage: no serious a11y issues, no clipping at ${width} ${scheme}`, async ({ page }) => {
        await open(page, { width, scheme });
        const sheet = await openImport(page, /Choose file Import old bundles/);
        await chooseFile(page, {
          name: "a-rather-long-file-name-from-the-office-pc-old-stock-2026.csv",
          mimeType: "text/csv",
          buffer: csv([
            [...BUNDLE_HEADERS, "Remarks"],
            ["PATTI", "14701", 25, 58.4, 3658, "PO-1", "ok"],
            ["ANGLE", "11250", 30, "", 3505, "", ""],
          ]),
        });
        await expect(stage(page)).toHaveAttribute("data-stage", "review");
        await expect(sheet.getByText("Not used: Remarks")).toBeVisible();
        expect(await blockingAxeViolations(page)).toEqual([]);
        await expectNoHorizontalScroll(page);
        await expectNoClippedText(page);
      });
    }
  }
});

test.describe("screenshots", () => {
  const dir = process.env.T25_SHOTS_DIR;
  test.skip(!dir, "set T25_SHOTS_DIR to capture review screenshots");

  for (const width of [375, 1280]) {
    for (const scheme of ["light", "dark"] as const) {
      test(`capture ${width} ${scheme}`, async ({ page }) => {
        test.setTimeout(120_000);
        mkdirSync(dir!, { recursive: true });
        const shot = (name: string) => page.screenshot({ path: join(dir!, `${name}-${width}-${scheme}.png`), fullPage: false });
        await open(page, { width, scheme, height: width < 768 ? 812 : 900 });
        await shot("data-tab");
        const sheet = await openImport(page, /Choose file Import old bundles/);
        await page.waitForTimeout(400);
        await shot("sheet-pick");
        await answer(page, "bundle.bulkImport", (input) => ({
          data: { success: true, bundleCount: (input as { rows: unknown[] }).rows.length, dieCount: 1, newDies: 1, newGroups: 1, reusedGroups: 0 },
        }));
        await chooseFile(page, {
          name: "old-stock.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: xlsx([
            [...BUNDLE_HEADERS, "Remarks"],
            ["PATTI", "14701", 25, 58.4, 3658, "PO-2611", ""],
            ["ANGLE", "11250", 30, 61.2, 3505, "", ""],
            ["TEE", "13090", 18, "", 3658, "", "weigh again"],
            ["TEE", "13090", 18, "1e3", 3658, "", ""],
            ["CHANNEL", "12212", 12.5, 40, 3658, "", ""],
          ]),
        });
        await expect(stage(page)).toHaveAttribute("data-stage", "review");
        await page.waitForTimeout(700);
        await shot("sheet-review");
        await sheet.locator(".overflow-y-auto").first().evaluate((el) => el.scrollTo(0, el.scrollHeight));
        await shot("sheet-review-problems");
        await sheet.getByRole("button", { name: "Import 2 rows" }).click();
        await expect(stage(page)).toHaveAttribute("data-stage", "done");
        await page.waitForTimeout(700);
        await shot("sheet-done");

        // A save that fails part-way.
        await page.keyboard.press("Escape");
        const customers = await openImport(page, /Choose file Import customers/);
        await answer(page, "customer.importCsv", (_input, call) =>
          call === 0 ? { data: { success: true, count: 500 } } : { error: "The server is busy. Try again.", status: 400 },
        );
        const parties: (string | number)[][] = [["Name", "Phone", "GSTIN"]];
        for (let i = 1; i <= 640; i++) parties.push([`Shree Ganesh Aluminium ${i}`, `98250 ${String(i).padStart(5, "0")}`, ""]);
        await chooseFile(page, { name: "parties.csv", mimeType: "text/csv", buffer: csv(parties) });
        await customers.getByRole("button", { name: "Import 640 rows" }).click();
        await expect(stage(page)).toHaveAttribute("data-stage", "failed");
        await page.waitForTimeout(400);
        await shot("sheet-failed");

        // Missing columns.
        await customers.getByRole("button", { name: "Close" }).last().click();
        const dies = await openImport(page, /Choose file Import dies/);
        await chooseFile(page, { name: "dies.csv", mimeType: "text/csv", buffer: csv([["Series", "Name"], ["PATTI", "Patti"]]) });
        await expect(dies.getByRole("alert")).toContainText("Columns missing");
        await page.waitForTimeout(400);
        await shot("sheet-missing");

        // The same sheet from the Dies and Customers lists.
        await page.keyboard.press("Escape");
        await page.goto("/dies");
        await page.getByRole("button", { name: "Import dies", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.waitForTimeout(400);
        await shot("dies-import-pick");
        await page.goto("/customers");
        await page.getByRole("button", { name: "Import customers", exact: true }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.waitForTimeout(400);
        await shot("customers-import-pick");
      });
    }
  }
});
