import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route } from "@playwright/test";
import * as XLSX from "xlsx";

import { gotoReady } from "./helpers/resilient";
import { test } from "./helpers/test";
import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";
import { expectNoClippedText, expectNoHorizontalScroll } from "../helpers/layout-guards";

/**
 * Settings → Data and the import sheet (Task 25, audit W1/W10). The seeded
 * demo company measures in inches, which is exactly the Review Focus 4 case:
 * a mm sheet must land as 3658 mm, never 25.4 times off. Two tests save for
 * real and read the bundles back (one sends the same sheet twice: nothing is
 * added twice); the chunking, failure and retry tests answer the import calls
 * in the browser so they don't fill the local database.
 *
 * Screenshots for review: set T25_SHOTS_DIR to write them.
 */

type Scheme = "light" | "dark";

async function open(page: Page, opts: { width: number; scheme?: Scheme; role?: LocalRole; height?: number }) {
  await page.setViewportSize({ width: opts.width, height: opts.height ?? 900 });
  await page.emulateMedia({ colorScheme: opts.scheme ?? "light", reducedMotion: "reduce" });
  await signInViaApi(page, opts.role ?? "owner");
  // A worker's first page pulls every module cold from Vite dev; on a loaded machine that alone
  // takes longer than the 5 s default (blank "Loading" page, no h1), so the first paint gets 20 s (one reload if it stalls).
  await gotoReady(page, "/settings?tab=data", page.locator("main#main h1").first(), 20_000);
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

type Reply =
  | { data: unknown }
  | { error: string; status: number; code: string }
  /** No answer at all (connection lost), optionally after a wait. */
  | { abort: true; afterMs?: number };

/** Answers one tRPC procedure in the browser (batched or not) and records every input it was sent. */
async function answer(page: Page, procedure: string, reply: (input: unknown, call: number) => Reply | Promise<Reply>) {
  const inputs: unknown[] = [];
  await page.route(`**/trpc/${procedure}**`, async (route: Route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    const url = new URL(req.url());
    const batched = url.searchParams.get("batch") === "1";
    const body = req.postDataJSON() as Record<string, unknown>;
    const input = batched ? body["0"] : body;
    inputs.push(input);
    const out = await reply(input, inputs.length - 1);
    if ("abort" in out) {
      if (out.afterMs) await new Promise((r) => setTimeout(r, out.afterMs));
      await route.abort("connectionreset");
      return;
    }
    const entry =
      "data" in out
        ? { result: { data: out.data } }
        : { error: { message: out.error, code: -32600, data: { code: out.code, httpStatus: out.status } } };
    await route.fulfill({
      status: "data" in out ? 200 : out.status,
      contentType: "application/json",
      body: JSON.stringify(batched ? [entry] : entry),
    });
  });
  return inputs;
}

/** Makes `auth.me` say the signed-in person has another role (the seed has no account for every role). */
async function actAs(page: Page, role: string) {
  const seen = { rewritten: 0 };
  await page.route(/\/trpc\/[^?]*auth\.me/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const json = (await res.json()) as unknown;
    const names = decodeURIComponent(new URL(route.request().url()).pathname.split("/trpc/")[1] ?? "").split(",");
    const entries = (Array.isArray(json) ? json : [json]) as { result?: { data?: Record<string, unknown> } }[];
    names.forEach((name, i) => {
      const me = entries[i]?.result?.data as
        | { company?: { id?: string; role: string } | null; memberships?: { companyId: string; role: string }[] }
        | undefined;
      if (name !== "auth.me" || !me?.company) return;
      me.company.role = role;
      seen.rewritten += 1;
      me.memberships = me.memberships?.map((m) => (m.companyId === me.company!.id ? { ...m, role } : m));
    });
    await route.fulfill({ response: res, json });
  });
  return seen;
}

const BUNDLE_HEADERS = ["Die series", "Section code", "Pieces", "Weight (kg)", "Length (mm)", "PO number"];
const bulkOk = (input: unknown, replayed = false) => ({
  data: {
    success: true,
    replayed,
    bundleCount: (input as { rows: unknown[] }).rows.length,
    dieCount: 1,
    newDies: 0,
    newGroups: 0,
    reusedGroups: 1,
  },
});

test.describe("Data tab", () => {
  test("owner sees the three imports with one labelled button each", async ({ page }) => {
    await open(page, { width: 1280 });
    const tab = page.locator("[data-slot='data-tab']");
    await expect(tab.getByRole("heading", { level: 2 })).toHaveText(["Import old bundles", "Import dies", "Import customers"]);
    await expect(page.getByRole("button", { name: "Choose file Import old bundles" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose file Import dies" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose file Import customers" })).toBeVisible();
  });

  test("a manager holds the three import actions, so the tab shows them too (permission matrix, not role names)", async ({ page }) => {
    const manager = await actAs(page, "manager");
    await open(page, { width: 1280 });
    await expect(page.locator("[data-slot='data-tab'] li")).toHaveCount(3);
    expect(manager.rewritten).toBeGreaterThan(0);
    // A background auth.me refetch may still be in the rewrite when the page closes.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("an operator is told their role can't import", async ({ page }) => {
    await open(page, { width: 390, role: "operator" });
    await expect(page.getByText("Your role can't import data.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Choose file/ })).toHaveCount(0);
  });

  for (const width of [390, 820, 1280]) {
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

  test("keyboard only: Tab and Enter from the Data tab through an import", async ({ page }) => {
    await open(page, { width: 1280 });
    await answer(page, "customer.importCsv", (input) => ({
      data: { success: true, count: (input as { rows: unknown[] }).rows.length, replayed: false },
    }));
    const tabTo = async (name: string | RegExp, max = 80) => {
      for (let i = 0; i < max; i++) {
        await page.keyboard.press("Tab");
        const focused = page.locator(":focus");
        const label = (await focused.getAttribute("aria-label")) ?? "";
        const text = `${label} ${(await focused.textContent()) ?? ""}`.replace(/\s+/g, " ");
        if (typeof name === "string" ? text.includes(name) : name.test(text)) return;
      }
      throw new Error(`Tab never reached ${String(name)}`);
    };
    const row = page.getByRole("button", { name: "Choose file Import customers" });
    await tabTo("Choose file");
    // The three row buttons come in order; walk on to the customers one.
    for (let i = 0; i < 3 && !(await row.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(row).toBeFocused();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    await tabTo(/^ ?Choose file$/);
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles({ name: "parties.csv", mimeType: "text/csv", buffer: csv([["Name"], ["Shree Ganesh Aluminium"]]) });

    // Focus lands on the result of reading, not back at the top of the dialog.
    await expect(page.locator("[data-slot='import-counts']")).toBeFocused();
    await tabTo("Import 1 row");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-slot='import-result']")).toBeFocused();
    await tabTo("Done");
    await page.keyboard.press("Enter");
    await expect(sheet).toBeHidden();
    await expect(row).toBeFocused();
  });
});

test.describe("import sheet", () => {
  test("a mm sheet into the inch company stores 3658 mm (Review Focus 4); the same sheet again adds nothing", async ({ page }) => {
    await open(page, { width: 1280 });
    const po = `E2E-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
    const file = {
      name: "old-stock.csv",
      mimeType: "text/csv",
      buffer: csv([
        // "(in mm)" is how many office sheets write it: still mm, never the company's inches.
        ["Die series", "Section code", "Pieces", "Weight (kg)", "Length (in mm)", "PO number"],
        ["PATTI", "14701", 25, 58.4, 3658, po],
        ["PATTI", "14701", 25, "", 3658, po],
        ["PATTI", "14701", 25, "1e3", 3658, po],
        // A decimal comma is a problem row, never 584 kg.
        ["PATTI", "14701", 25, "58,4", 3658, po],
      ]),
    };
    let sheet = await openImport(page, /Choose file Import old bundles/);
    await chooseFile(page, file);
    await expect(stage(page)).toHaveAttribute("data-stage", "review");
    // Focus moves to the counts, which say what was found.
    const counts = page.locator("[data-slot='import-counts']");
    await expect(counts).toBeFocused();
    await expect(counts).toHaveAttribute("aria-label", "1 row ready. 3 rows with problems.");
    await expect(sheet.locator("[data-slot='status-block']").first()).toContainText("Ready to import");
    await expect(sheet.locator("[data-slot='status-block']").nth(1)).toContainText("Need fixing");
    await expect(sheet.getByRole("definition").filter({ hasText: "Length in mm" })).toBeVisible();
    // The preview shows it the way this company reads lengths.
    await expect(sheet.getByText("12 ft", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Weight (kg) is empty.")).toBeVisible();
    await expect(sheet.getByText("Weight (kg) is not a plain number. Use a point for decimals, like 45.5.")).toHaveCount(2);

    await sheet.getByRole("button", { name: "Import 1 row" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    const result = page.locator("[data-slot='import-result']");
    await expect(result).toBeFocused();
    await expect(result).toHaveAttribute("aria-label", "1 row imported");
    // The rows with problems come back as a file: say to import only that one.
    await expect(page.locator("[data-slot='import-done-help']")).toHaveText(
      "Fix the downloaded rows and import only that file. Don't import this whole file again.",
    );

    type Listed = { items: { lengthMm: number; weightG: number; quantity: number }[] };
    const saved = await trpcQuery<Listed>(page, "bundle.listBundles", { search: po, limit: 10 });
    expect(saved.items).toEqual([expect.objectContaining({ lengthMm: 3658, weightG: 58400, quantity: 25 })]);

    // The same sheet again (a corrected copy of a sheet that was already imported): the row this
    // browser saved is a problem row, not a second bundle.
    await sheet.getByRole("button", { name: "Done" }).click();
    sheet = await openImport(page, /Choose file Import old bundles/);
    await chooseFile(page, file);
    await expect(stage(page)).toHaveAttribute("data-stage", "review");
    await expect(page.locator("[data-slot='import-counts']")).toHaveAttribute("aria-label", "0 rows ready. 4 rows with problems.");
    await expect(
      sheet.getByText("This row (same row number, same values) was already imported from an earlier copy of this file, so it is not added again."),
    ).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^Import \d+ row/ })).toHaveCount(0);

    // A browser that does not remember (another PC, cleared data): the server knows these rows.
    await page.evaluate(() => window.localStorage.clear());
    await sheet.getByRole("button", { name: "Close", exact: true }).last().click();
    sheet = await openImport(page, /Choose file Import old bundles/);
    await chooseFile(page, file);
    await sheet.getByRole("button", { name: "Import 1 row" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    await expect(sheet.getByText("Already imported", { exact: true })).toBeVisible();
    await expect(
      sheet.getByText("1 row was already in orrn from an earlier import of this sheet, so it was not added again."),
    ).toBeVisible();
    expect((await trpcQuery<Listed>(page, "bundle.listBundles", { search: po, limit: 10 })).items).toHaveLength(1);
  });

  test("an Excel sheet with Length (in) 144 reads as 3658 mm; each call carries a request id", async ({ page }) => {
    await open(page, { width: 1280 });
    const sheet = await openImport(page, /Choose file Import old bundles/);
    const sent = await answer(page, "bundle.bulkImport", (input) => bulkOk(input));
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
    expect(sent).toEqual([
      {
        rows: [{ dieSeries: "PATTI", dieSectionCode: "14701", quantity: 10, weightG: 23500, lengthMm: 3658, poNumber: null }],
        clientRequestId: expect.stringMatching(/^imp-[0-9a-f]{40}$/),
      },
    ]);
  });

  test("a file dropped on the drop zone is read; one dropped elsewhere never leaves orrn", async ({ page }) => {
    await open(page, { width: 1280 });
    const sheet = await openImport(page, /Choose file Import customers/);
    const dropped = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["Name\nAcme Extrusions\n"], "parties.csv", { type: "text/csv" }));
      // Outside the zone: the sheet title. Unhandled, the browser would open the file in this tab.
      const outside = new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
      document.querySelector("[role='dialog'] h2")!.dispatchEvent(outside);
      const zone = document.querySelector("[data-slot='import-drop']")!;
      zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
      zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      return { outsidePrevented: outside.defaultPrevented };
    });
    expect(dropped.outsidePrevented).toBe(true);
    await expect(stage(page)).toHaveAttribute("data-stage", "review");
    await expect(sheet.getByText("parties.csv")).toBeVisible();
  });

  test("1,200 customers go in calls of 500; a call that fails on the server resumes with the same request id", async ({ page }) => {
    await open(page, { width: 1280 });
    const sheet = await openImport(page, /Choose file Import customers/);
    let failOnce = true;
    const sent = await answer(page, "customer.importCsv", (input, call) => {
      const { rows } = input as { rows: { name: string }[] };
      if (call === 1 && failOnce) {
        failOnce = false;
        return { error: "D1_ERROR: something internal", status: 500, code: "INTERNAL_SERVER_ERROR" };
      }
      return { data: { success: true, count: rows.length, replayed: false } };
    });
    const rows: (string | number)[][] = [["Name", "Phone"]];
    for (let i = 1; i <= 1200; i++) rows.push([`Party ${i}`, `98250 ${String(i).padStart(5, "0")}`]);
    await chooseFile(page, { name: "parties.csv", mimeType: "text/csv", buffer: csv(rows) });
    await expect(sheet.locator("[data-slot='status-block']").first()).toContainText("1,200");
    await sheet.getByRole("button", { name: "Import 1,200 rows" }).click();

    await expect(stage(page)).toHaveAttribute("data-stage", "failed");
    const failed = page.locator("[data-slot='import-failed']");
    await expect(failed).toBeFocused();
    await expect(failed).toContainText("Saved 500 of 1,200 rows, up to row 501. orrn can't tell yet if 500 rows from row 502 to row 1001 were saved.");
    // Never the server's own text.
    await expect(failed).toContainText("orrn's server ran into a problem.");
    await expect(failed).not.toContainText("D1_ERROR");
    await expect(failed).toContainText("Try again: rows that were already saved are not added twice.");
    // Nothing in the failed state starts the file over.
    await expect(sheet.getByRole("button", { name: "Choose another file" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Download rows not saved" })).toHaveCount(0);

    await sheet.getByRole("button", { name: "Try the rest again" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    await expect(sheet.locator("[data-slot='status-block']")).toContainText("1,200");

    const calls = sent as { rows: { name: string }[]; clientRequestId: string }[];
    expect(calls.map((c) => c.rows.length)).toEqual([500, 500, 500, 200]);
    // The retry starts at the failed call, with the same id (a lost reply can't save it twice); Party 1 is sent once.
    expect(calls[2]!.rows[0]!.name).toBe("Party 501");
    expect(calls[2]!.clientRequestId).toBe(calls[1]!.clientRequestId);
    expect(new Set(calls.map((c) => c.clientRequestId)).size).toBe(3);
    expect(calls.flatMap((c) => c.rows).filter((r) => r.name === "Party 1")).toHaveLength(1);
  });

  test("a lost reply: closing is blocked while saving, the sheet says the rows may be saved, and the resend counts once", async ({ page }) => {
    await open(page, { width: 1280 });
    const sheet = await openImport(page, /Choose file Import old bundles/);
    const sent = await answer(page, "bundle.bulkImport", (input, call) => {
      if (call === 0) return bulkOk(input);
      // The second call never gets an answer (plant Wi-Fi drops after the server saved it).
      if (call === 1) return { abort: true, afterMs: 1500 };
      // Sent again: the server recognises the request id.
      return bulkOk(input, true);
    });
    const rows: (string | number)[][] = [BUNDLE_HEADERS];
    for (let i = 1; i <= 700; i++) rows.push(["PATTI", "14701", 25, 58.4, 3658, `PO-${i}`]);
    await chooseFile(page, { name: "old-stock.csv", mimeType: "text/csv", buffer: csv(rows) });
    await sheet.getByRole("button", { name: "Import 700 rows" }).click();

    // While saving: Escape does nothing and the close button is not offered.
    await expect(stage(page)).toHaveAttribute("data-stage", "saving");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("[data-slot='sheet-close']")).toBeHidden();

    await expect(stage(page)).toHaveAttribute("data-stage", "failed");
    const failed = page.locator("[data-slot='import-failed']");
    await expect(failed).toContainText("Saved 500 of 700 rows, up to row 501. orrn can't tell yet if 200 rows from row 502 to row 701 were saved.");
    await expect(failed).toContainText("No internet connection. Check it and try again.");
    await expect(failed).not.toContainText("were not saved");
    await expect(sheet.getByRole("button", { name: "Choose another file" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Download rows not saved" })).toHaveCount(0);

    await sheet.getByRole("button", { name: "Try the rest again" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    // The resent call was this run's own: all 700 count as imported, none as "already".
    await expect(sheet.locator("[data-slot='status-block']")).toContainText("700");
    await expect(sheet.getByText(/already in orrn/)).toHaveCount(0);
    const calls = sent as { rows: { poNumber: string }[]; clientRequestId: string }[];
    expect(calls.map((c) => c.rows[0]!.poNumber)).toEqual(["PO-1", "PO-501", "PO-501"]);
    expect(calls[2]!.clientRequestId).toBe(calls[1]!.clientRequestId);
  });

  test("a refused call: no retry, the unsaved rows download, and closing asks first; no path sends the first call again", async ({ page }) => {
    await open(page, { width: 390 });
    const sheet = await openImport(page, /Choose file Import customers/);
    const sent = await answer(page, "customer.importCsv", (input, call) =>
      call === 0
        ? { data: { success: true, count: (input as { rows: unknown[] }).rows.length, replayed: false } }
        : { error: "Restore them from the dies page before importing.", status: 400, code: "BAD_REQUEST" },
    );
    const rows: (string | number)[][] = [["Name"]];
    for (let i = 1; i <= 640; i++) rows.push([`Party ${i}`]);
    await chooseFile(page, { name: "parties.csv", mimeType: "text/csv", buffer: csv(rows) });
    await sheet.getByRole("button", { name: "Import 640 rows" }).click();

    await expect(stage(page)).toHaveAttribute("data-stage", "failed");
    const failed = page.locator("[data-slot='import-failed']");
    await expect(failed).toContainText("Saved 500 of 640 rows, up to row 501. Nothing from row 502 on was saved.");
    await expect(failed).toContainText("orrn did not accept these rows.");
    await expect(failed).not.toContainText("Restore them");
    await expect(sheet.getByRole("button", { name: "Try the rest again" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Choose another file" })).toHaveCount(0);
    const download = page.waitForEvent("download");
    await sheet.getByRole("button", { name: "Download rows not saved" }).click();
    expect((await download).suggestedFilename()).toBe("orrn-customers-not-saved.csv");

    // Close (and Escape) ask first; Keep open goes back; Close anyway closes.
    await sheet.getByRole("button", { name: "Close", exact: true }).last().click();
    const confirm = page.locator("[data-slot='import-confirm-close']");
    await expect(confirm).toBeFocused();
    await expect(confirm).toContainText("Close this import?");
    await expect(confirm).toContainText("140 rows were not saved.");
    await sheet.getByRole("button", { name: "Keep open" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(failed).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeVisible();
    await sheet.getByRole("button", { name: "Close anyway" }).click();
    await expect(sheet).toBeHidden();
    expect((sent as { rows: { name: string }[] }[]).filter((c) => c.rows[0]!.name === "Party 1")).toHaveLength(1);
  });

  test("an old-bundles sheet naming a deleted die: those rows are problems before anything is saved", async ({ page }) => {
    await open(page, { width: 1280 });
    const sheet = await openImport(page, /Choose file Import old bundles/);
    await answer(page, "bundle.importCheck", (input) => {
      const { dies } = input as { dies: { series: string; sectionCode: string }[] };
      return { data: { deleted: dies.filter((d) => d.sectionCode === "GONE-1") } };
    });
    const sent = await answer(page, "bundle.bulkImport", (input) => bulkOk(input));
    await chooseFile(page, {
      name: "old-stock.csv",
      mimeType: "text/csv",
      buffer: csv([
        BUNDLE_HEADERS,
        ["PATTI", "14701", 25, 58.4, 3658, ""],
        ["OLD", "GONE-1", 25, 58.4, 3658, ""],
      ]),
    });
    await expect(page.locator("[data-slot='import-counts']")).toHaveAttribute("aria-label", "1 row ready. 1 row with problems.");
    await expect(sheet.getByText("This die was deleted in orrn, so bundles can't be added to it.")).toBeVisible();
    await sheet.getByRole("button", { name: "Import 1 row" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    expect((sent[0] as { rows: { dieSectionCode: string }[] }).rows.map((r) => r.dieSectionCode)).toEqual(["14701"]);
  });

  test("dies already in orrn are left alone by default; Update sends only the columns the sheet has", async ({ page }) => {
    await open(page, { width: 1280 });
    let sheet = await openImport(page, /Choose file Import dies/);
    const sent = await answer(page, "die.processImport", (input) => {
      const i = input as { newRows: unknown[]; updatedRows: unknown[] };
      return { data: { success: true, count: i.newRows.length + i.updatedRows.length, replayed: false } };
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
    // The die weight columns are read once as kg per 12 ft.
    await expect(sheet.locator("dl > div").filter({ hasText: "Min weight (kg/12ft)" }).getByRole("definition")).toHaveText(
      "Min weight in kg per 12 ft",
    );
    await expect(sheet.getByRole("radio", { name: "Leave as they are" })).toBeChecked();
    await sheet.getByRole("button", { name: "Import 1 row" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    expect(sent[0]).toMatchObject({ newRows: [expect.objectContaining({ sectionCode: code })], updatedRows: [] });

    // A weight-band sheet with only the four needed columns, as "Update from this sheet".
    await sheet.getByRole("button", { name: "Done" }).click();
    sheet = await openImport(page, /Choose file Import dies/);
    const bands = {
      name: "bands.csv",
      mimeType: "text/csv",
      buffer: csv([
        ["Series", "Section code", "Min weight (kg/12ft)", "Max weight (kg/12ft)"],
        ["PATTI", "14701", 2.4, 2.6],
      ]),
    };
    await chooseFile(page, bands);
    await sheet.getByRole("radio", { name: "Update from this sheet" }).click();
    await expect(
      sheet.getByText("Only the columns in this sheet change. Empty cells, and columns the sheet doesn't have, keep what orrn has."),
    ).toBeVisible();
    // A new file starts again from the safe choice.
    await sheet.getByRole("button", { name: "Choose another file" }).click();
    await chooseFile(page, bands);
    await expect(sheet.getByRole("radio", { name: "Leave as they are" })).toBeChecked();
    await sheet.getByRole("radio", { name: "Update from this sheet" }).click();
    await sheet.getByRole("button", { name: "Import 1 row" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    // Exactly these keys: no name, notes or geometry to blank, no status to re-activate an archived die.
    expect((sent[1] as { updatedRows: unknown[] }).updatedRows).toEqual([
      { existingId: expect.any(String), series: "PATTI", sectionCode: "14701", weightMinG: 2400, weightMaxG: 2600, dimensions: {} },
    ]);
    await expect(sheet.getByText("0 new dies, 1 updated.")).toBeVisible();
  });

  test("a sheet without a required column says which one; other files are refused", async ({ page }) => {
    await open(page, { width: 390 });
    const sheet = await openImport(page, /Choose file Import old bundles/);
    await chooseFile(page, { name: "notes.json", mimeType: "application/json", buffer: Buffer.from("[]") });
    await expect(sheet.locator("[data-slot='import-error']")).toHaveText(
      "This is not a CSV or Excel file. Choose a .csv, .xlsx or .xls file.",
    );
    // Focus is back on "Choose file", which the error describes.
    const choose = sheet.getByRole("button", { name: "Choose file" });
    await expect(choose).toBeFocused();
    await expect(choose).toHaveAccessibleDescription(/This is not a CSV or Excel file/);
    await chooseFile(page, {
      name: "no-weight.csv",
      mimeType: "text/csv",
      buffer: csv([
        ["Die series", "Section code", "Pieces", "Length (mm)", "Weight (net)"],
        ["PATTI", "14701", 3, 3658, 40],
      ]),
    });
    const missing = page.locator("[data-slot='import-missing']");
    await expect(missing).toBeFocused();
    await expect(missing).toContainText("Columns missing");
    await expect(missing).toContainText("Weight (kg)");
    // The column that looked right says why it was not used.
    await expect(missing).toContainText("Not used, the unit is not clear: Weight (net).");
    // The live region stays quiet: focus already reads the block.
    await expect(page.locator("[data-slot='import-announce']")).toHaveText("");
    await expectNoHorizontalScroll(page);
  });

  test("two columns for one field are named, not guessed; feet and inches columns add up", async ({ page }) => {
    await open(page, { width: 390 });
    const sheet = await openImport(page, /Choose file Import old bundles/);
    const sent = await answer(page, "bundle.bulkImport", (input) => bulkOk(input));
    await chooseFile(page, {
      name: "two-lengths.csv",
      mimeType: "text/csv",
      buffer: csv([
        ["Die series", "Section code", "Pieces", "Weight (kg)", "Length (mm)", "Length (in)"],
        ["PATTI", "14701", 3, 40, 3000, 144],
      ]),
    });
    const conflict = page.locator("[data-slot='import-conflict']");
    await expect(conflict).toBeVisible();
    await expect(page.locator("[data-slot='import-missing']")).toContainText("Two columns fill the same field");
    await expect(conflict).toContainText("Length (mm), Length (in)");
    await expect(sheet.getByRole("button", { name: /^Import \d+ row/ })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // A Weight Kg/12ft die band is never read as the bundle weight.
    await sheet.getByRole("button", { name: "Choose another file" }).click();
    await chooseFile(page, {
      name: "band-only.csv",
      mimeType: "text/csv",
      buffer: csv([
        ["Die series", "Section code", "Pieces", "Bundle Wt", "Weight Kg/12ft", "Length (mm)"],
        ["PATTI", "14701", 3, 40, 2.5, 3658],
      ]),
    });
    await expect(page.locator("[data-slot='import-missing']")).toContainText("Weight (kg)");
    await expect(page.locator("[data-slot='import-missing']")).toContainText("Weight Kg/12ft");

    await sheet.getByRole("button", { name: "Choose another file" }).click();
    await chooseFile(page, {
      name: "feet-and-inches.csv",
      mimeType: "text/csv",
      buffer: csv([
        ["Die series", "Section code", "Pieces", "Weight (kg)", "Cut Length (ft)", "Cut Length (Inch)"],
        ["PATTI", "14701", 3, 40, 11, 6],
      ]),
    });
    await sheet.getByRole("button", { name: "Import 1 row" }).click();
    await expect(stage(page)).toHaveAttribute("data-stage", "done");
    expect((sent[0] as { rows: { lengthMm: number }[] }).rows[0]!.lengthMm).toBe(3505);
  });

  for (const width of [390, 820, 1280]) {
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

test.describe("touch", () => {
  test("a phone is asked to choose a file, with 56 px buttons", async ({ browser }) => {
    // A fresh touch context: (pointer: coarse) matches from its first document.
    const context = await browser.newContext({
      baseURL: WEB_ORIGIN,
      viewport: { width: 375, height: 812 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await signInViaApi(page, "owner");
      await page.goto("/settings?tab=data");
      await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 20_000 });
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
      const sheet = await openImport(page, /Choose file Import customers/);
      await expect(sheet.getByText("Choose a CSV or Excel file")).toBeVisible();
      await expect(sheet.getByText("Drop a CSV or Excel file here")).toBeHidden();
      const choose = await sheet.getByRole("button", { name: "Choose file" }).boundingBox();
      expect(choose!.height).toBeGreaterThanOrEqual(56);
      await answer(page, "customer.importCsv", () => ({ data: { success: true, count: 1, replayed: false } }));
      await chooseFile(page, { name: "parties.csv", mimeType: "text/csv", buffer: csv([["Name"], ["Acme"]]) });
      const primary = await sheet.getByRole("button", { name: "Import 1 row" }).boundingBox();
      expect(primary!.height).toBeGreaterThanOrEqual(56);
    } finally {
      await context.close();
    }
  });
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
          data: { ...bulkOk(input).data, newDies: 1, newGroups: 1, reusedGroups: 0 },
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

        // A save that fails part-way: the reply is lost, then a refusal.
        await page.keyboard.press("Escape");
        let customers = await openImport(page, /Choose file Import customers/);
        let refuse = false;
        await answer(page, "customer.importCsv", (_input, call) =>
          call === 0 || call === 2
            ? { data: { success: true, count: 500, replayed: false } }
            : refuse
              ? { error: "Bad rows", status: 400, code: "BAD_REQUEST" }
              : { abort: true },
        );
        const parties: (string | number)[][] = [["Name", "Phone", "GSTIN"]];
        for (let i = 1; i <= 640; i++) parties.push([`Shree Ganesh Aluminium ${i}`, `98250 ${String(i).padStart(5, "0")}`, ""]);
        await chooseFile(page, { name: "parties.csv", mimeType: "text/csv", buffer: csv(parties) });
        await customers.getByRole("button", { name: "Import 640 rows" }).click();
        await expect(stage(page)).toHaveAttribute("data-stage", "failed");
        await page.waitForTimeout(400);
        await shot("sheet-failed-unknown");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        await shot("sheet-failed-confirm");
        await customers.getByRole("button", { name: "Close anyway" }).click();
        refuse = true;
        customers = await openImport(page, /Choose file Import customers/);
        await chooseFile(page, { name: "parties.csv", mimeType: "text/csv", buffer: csv(parties) });
        await customers.getByRole("button", { name: "Import 640 rows" }).click();
        await expect(stage(page)).toHaveAttribute("data-stage", "failed");
        await page.waitForTimeout(400);
        await shot("sheet-failed-refused");

        // Missing columns.
        await customers.getByRole("button", { name: "Close", exact: true }).last().click();
        await customers.getByRole("button", { name: "Close anyway" }).click();
        const dies = await openImport(page, /Choose file Import dies/);
        await chooseFile(page, { name: "dies.csv", mimeType: "text/csv", buffer: csv([["Series", "Name"], ["PATTI", "Patti"]]) });
        await expect(page.locator("[data-slot='import-missing']")).toContainText("Columns missing");
        await page.waitForTimeout(400);
        await shot("sheet-missing");

        // The same sheet from the Dies and Customers lists.
        await dies.getByRole("button", { name: "Close", exact: true }).last().click();
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
