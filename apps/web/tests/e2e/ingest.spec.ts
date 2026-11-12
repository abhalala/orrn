import { headerKey, normalizeHeaders } from "@orrn/ingest";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { makeParty, q } from "./helpers/orders-api";
import { API_URL } from "./helpers/ports";

/**
 * Infinity Portal: the browser flow, on the local stack, against the rebuilt screens (work order 3.1 to 3.6).
 *
 *   1. An admin uploads the die template CSV, sees "Known layout" with no question, approves from the list, merges
 *      from the sticky bar through the confirm sheet, and finds the sections in the catalog.
 *   2. A second sheet with unknown headers goes through the helper (a scripted shape client installed through
 *      `POST /dev/ingest-bot`, local only, never a model call), the person approves on the review page, and merges.
 *   3. A held import stays out of the merge, and "Check again" on the review page brings it back.
 *   4. The same file uploaded twice says "You added this file on ..." with "Open it".
 *   5. A role without the import actions gets no drop zone and no file input.
 *   6. A near fit asks once ("Use this layout"); the next upload with the same headers fits with no question.
 *   7. A weight outside the believable range asks, and the answer restages the row.
 *   8. "Approve all N" approves only imports with no open question.
 *   9. The header step: a sheet with a letterhead is asked "Which row has the column names?" and carries on after the
 *      pick; a header on another row that fits a known layout is read again with no question; a second table below a
 *      blank row is joined with "It continues the table above"; "007" and "18%" arrive as written.
 *  10. A PDF is kept, not read. One PO on two orders is shown as a conflict.
 *
 * Every file is made fresh per run: its series and section codes carry a run stamp, so a second run never meets the
 * first run's sections, and no other spec's data is touched. Tests run one after another because a merge writes every
 * approved import of the plant.
 */

test.describe.configure({ mode: "serial", timeout: 150_000 });

const STAMP = Date.now().toString(36).toUpperCase().slice(-5);
const DIE_HEADER = "Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft),Name,Width (mm),Thickness (mm),Leg (mm),Status,Notes";

function dieRows(series: string, codes: string[]): string[] {
  return codes.map((code, i) => `${series},${code},${(1.1 + i / 10).toFixed(1)},${(1.4 + i / 10).toFixed(1)},Ingest test ${code},30,1.5,,active,`);
}

function dieCsv(series: string, codes: string[], header = DIE_HEADER): Buffer {
  return Buffer.from([header, ...dieRows(series, codes)].join("\n"));
}

async function openPortal(page: Page, role: LocalRole) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto("/ingest");
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
}

const fileInput = (page: Page) => page.locator("input[type='file']");
/** The heading row of one file on the list: the file name, "3 tables, added 11 Nov", and "Approve all N". */
const group = (page: Page, fileName: string): Locator => page.locator("[data-testid='ingest-file-group']", { hasText: fileName });
/** One file's part of the list: every file is a tbody of the one table, a heading row first and its imports after it. */
const section = (page: Page, fileName: string): Locator => page.locator("tbody", { has: group(page, fileName) });
/** The import rows of a file (not its heading row; the list is a table at 1280 px). */
const fileRows = (page: Page, fileName: string): Locator => section(page, fileName).locator("tr:not(:has(> td[colspan]))");
/** The first import row of a file. */
const row = (page: Page, fileName: string): Locator => fileRows(page, fileName).first();
/** A row of the strip "Files being added". */
const stripRow = (page: Page, fileName: string): Locator => page.locator("li[data-step]", { hasText: fileName });

async function upload(page: Page, name: string, buffer: Buffer, mimeType = "text/csv") {
  await fileInput(page).setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: /^Add \d+ files?$/ }).click();
}

async function waitRead(page: Page, fileName: string) {
  await expect(stripRow(page, fileName).getByText(/^Finished reading\. \d+ tables?/)).toBeVisible({ timeout: 60_000 });
}

async function segment(page: Page, name: "Needs you" | "Ready" | "Approved" | "Merged") {
  const radio = page.getByRole("radio", { name: new RegExp(`^${name} `) });
  await radio.click();
  await expect(radio).toBeChecked();
}

/** Wait until the file's import has left "Checking rows" and sits in the segment, then return its row. */
async function waitInSegment(page: Page, fileName: string, name: Parameters<typeof segment>[1], timeout = 90_000) {
  await expect(async () => {
    await segment(page, name);
    await expect(row(page, fileName)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout });
  return row(page, fileName);
}

async function mergeApproved(page: Page) {
  await page.goto("/ingest");
  const open = page.getByRole("button", { name: /^Merge \d+ approved imports?$/ });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/^Merge \d+ imports? into orrn\?$/)).toBeVisible();
  await sheet.getByRole("button", { name: /^Merge \d+ approved imports?$/ }).click();
  await expect(page).toHaveURL(/\/ingest\/merge\//, { timeout: 30_000 });
  // The page title says it (one h1); the block under it is a named group, not a second heading.
  await expect(page.getByRole("heading", { name: "Merge finished", level: 1 })).toBeVisible({ timeout: 120_000 });
  // "1 row added" or "700 rows added": the unit follows the count.
  await expect(page.getByText(/^rows? added$/).first()).toBeVisible();
}

async function sectionVisible(page: Page, code: string) {
  await page.goto(`/dies?q=${encodeURIComponent(code)}`);
  await expect(page.getByText(code).first()).toBeVisible({ timeout: 30_000 });
}

async function sectionAbsent(page: Page, code: string) {
  await page.goto(`/dies?q=${encodeURIComponent(code)}`);
  // The empty state repeats the search ("Nothing matches ..."), so the code is not looked for as a row: the page
  // must say nothing matches, and no table row may carry it.
  await expect(page.getByText(/^Nothing matches/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("tbody").getByText(code)).toHaveCount(0);
}

async function fakeBot(request: APIRequestContext, body: unknown) {
  const res = await request.post(`${API_URL}/dev/ingest-bot`, { data: body });
  expect(res.ok(), `/dev/ingest-bot answered ${res.status()}`).toBe(true);
}

/** Open an import from its row on the list. */
async function openReview(page: Page, fileName: string, segmentName: Parameters<typeof segment>[1]) {
  const r = await waitInSegment(page, fileName, segmentName);
  await r.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/ingest\/review\//);
  await expect(page.getByTestId("decision-bar")).toBeVisible({ timeout: 30_000 });
}

const decisionBar = (page: Page) => page.getByTestId("decision-bar");

/** The header step ("Which row has the column names?") of the file being added. */
const headerStep = (page: Page) => page.getByTestId("header-step");

/** Wait for the header step, pick a row by its number on the sheet and use it. */
async function pickHeaderRow(page: Page, n: number) {
  const step = headerStep(page);
  await expect(step.getByRole("heading", { name: "Which row has the column names?" })).toBeVisible({ timeout: 60_000 });
  await step.getByRole("radio", { name: new RegExp(`^Row ${n}:`) }).check();
  await step.getByRole("button", { name: `Use row ${n}` }).click();
}

/** `ingest.artifact.putBlocks` calls the page makes, to see how many times a table's header was sent. */
function countPutBlocks(page: Page): { count: () => number } {
  let n = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("ingest.artifact.putBlocks")) n += 1;
  });
  return { count: () => n };
}

test.describe("imports portal", () => {
  test("an admin reads the die template, sees a known layout, approves and merges", async ({ page }) => {
    const series = `Z${STAMP.slice(0, 3)}`;
    const codes = [`${STAMP}1`, `${STAMP}2`, `${STAMP}3`];
    const name = `dies-${STAMP}.csv`;
    await openPortal(page, "admin");

    await upload(page, name, dieCsv(series, codes));
    // The layout is known, so there is no model call and no question: the strip says what was found.
    await expect(stripRow(page, name).getByText(/^Finished reading\. 1 table: .*Known layout\.$/)).toBeVisible({ timeout: 60_000 });

    // Ready, with no question chip, and one action: Approve.
    const r = await waitInSegment(page, name, "Ready");
    await expect(r.getByText("Known layout")).toBeVisible();
    await expect(r.getByText(/question/)).toHaveCount(0);
    await r.getByRole("button", { name: /^Approve/ }).click();

    // It leaves Ready and shows under Approved with a Hold button; the sticky bar offers the merge.
    await segment(page, "Approved");
    await expect(row(page, name).getByRole("button", { name: /^Hold/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^\d+ imports? approved, [\d,]+ rows$/)).toBeVisible();

    await mergeApproved(page);
    await sectionVisible(page, codes[0]!);
  });

  test("a sheet with unknown headers goes through the helper, is reviewed, approved and merged", async ({ page, request }) => {
    const series = `Y${STAMP.slice(0, 3)}`;
    const code = `${STAMP}7`;
    const name = `unknown-${STAMP}.csv`;
    // The headers carry the run stamp: a layout the helper made and a person approved is remembered for the plant,
    // so the same headers on a later run would be a known layout, not an unknown one.
    const headers = [`Sec series ${STAMP}`, `Profile no ${STAMP}`, `Low ${STAMP} kg/12ft`, `High ${STAMP} kg/12ft`];
    const csv = Buffer.from([headers.join(","), `${series},${code},1.2,1.5`].join("\n"));

    const recipe = {
      schemaVersion: 1,
      target: "dies",
      headerRow: 0,
      headerRows: 1,
      match: { headerKey: headerKey(normalizeHeaders(headers)), headers: normalizeHeaders(headers) },
      fields: [
        { field: "series", source: { kind: "columns", cols: [{ col: 0, header: headers[0] }] }, steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
        { field: "sectionCode", source: { kind: "columns", cols: [{ col: 1, header: headers[1] }] }, steps: [{ op: "trim" }] },
        { field: "weightMinG", source: { kind: "columns", cols: [{ col: 2, header: headers[2] }] }, steps: [{ op: "number", kind: "linear_mass", unit: "kg/12ft" }] },
        { field: "weightMaxG", source: { kind: "columns", cols: [{ col: 3, header: headers[3] }] }, steps: [{ op: "number", kind: "linear_mass", unit: "kg/12ft" }] },
      ],
      filters: [],
      keys: ["series", "sectionCode"],
      onExisting: "ask",
      unclear: [],
    };
    await fakeBot(request, { action: "install", responses: [{ result: { kind: "recipe", recipe } }] });
    try {
      await openPortal(page, "admin");
      await upload(page, name, csv);
      // A clean sheet is not asked which row has the column names (server round 7): the reader's row is kept and the sheet
      // goes straight to "needs a layout".
      await expect(headerStep(page)).toHaveCount(0);
      // An unknown layout needs a person: it sits under Needs you with "Map columns".
      const r = await waitInSegment(page, name, "Needs you");
      await expect(r.getByText("Needs a layout")).toBeVisible();
      await expect(r.getByText("New table")).toBeVisible();

      await r.getByRole("link").first().click();
      await expect(page).toHaveURL(/\/ingest\/review\//);
      await expect(decisionBar(page)).toHaveAttribute("data-state", "needs_shape", { timeout: 30_000 });
      await page.getByRole("button", { name: "Map columns for me" }).click();
      await expect(decisionBar(page)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
      await expect(decisionBar(page).getByText("Layout made by orrn")).toBeVisible();
      // The person reads the rows as they will appear in orrn and approves.
      await expect(page.getByRole("heading", { name: "Rows as they will appear in orrn" })).toBeVisible();
      await expect(page.locator("table").getByText(code).first()).toBeVisible();
      await decisionBar(page).getByRole("button", { name: "Approve", exact: true }).click();
      await expect(decisionBar(page)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
      await expect(decisionBar(page).getByRole("link", { name: "Go to merge" })).toBeVisible();

      await mergeApproved(page);
      await sectionVisible(page, code);
    } finally {
      await fakeBot(request, { action: "clear" });
    }
  });

  test("a held import stays out of the merge and can be checked again", async ({ page }) => {
    const seriesA = `X${STAMP.slice(0, 3)}`;
    const seriesB = `W${STAMP.slice(0, 3)}`;
    const a = `${STAMP}A`;
    const b = `${STAMP}B`;
    const nameA = `approve-${STAMP}.csv`;
    const nameB = `hold-${STAMP}.csv`;
    await openPortal(page, "admin");
    await upload(page, nameA, dieCsv(seriesA, [a]));
    await waitRead(page, nameA);
    await upload(page, nameB, dieCsv(seriesB, [b]));
    await waitRead(page, nameB);

    const rowA = await waitInSegment(page, nameA, "Ready");
    await rowA.getByRole("button", { name: /^Approve/ }).click();
    await segment(page, "Approved");
    await expect(row(page, nameA).getByRole("button", { name: /^Hold/ })).toBeVisible({ timeout: 30_000 });

    // Hold lives on the review page: a sheet with reasons, then the import waits under Needs you.
    await openReview(page, nameB, "Ready");
    await decisionBar(page).getByRole("button", { name: "Hold", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Hold", exact: true }).click();
    await expect(decisionBar(page)).toHaveAttribute("data-state", "held", { timeout: 30_000 });

    await mergeApproved(page);
    await sectionVisible(page, a);
    await sectionAbsent(page, b);

    // The held import is still there, held; "Check again" runs it through the checks and it is ready once more.
    await page.goto("/ingest");
    const held = await waitInSegment(page, nameB, "Needs you");
    await expect(held.getByText("Held")).toBeVisible();
    await held.getByRole("link").first().click();
    await expect(decisionBar(page)).toHaveAttribute("data-state", "held", { timeout: 30_000 });
    await expect(decisionBar(page).getByRole("button", { name: "Approve as it is" })).toBeVisible();
    await decisionBar(page).getByRole("button", { name: "Check again" }).click();
    await expect(decisionBar(page)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    await sectionAbsent(page, b);
  });

  test("the same file uploaded twice says when it was added and offers to open it", async ({ page }) => {
    const name = `again-${STAMP}.csv`;
    const csv = dieCsv(`V${STAMP.slice(0, 3)}`, [`${STAMP}9`]);
    await openPortal(page, "admin");
    await upload(page, name, csv);
    await waitRead(page, name);
    await upload(page, `copy-of-${name}`, csv);
    const seen = stripRow(page, `copy-of-${name}`);
    await expect(seen.getByText(/^You added this file on .+\.$/)).toBeVisible({ timeout: 60_000 });
    await seen.getByRole("link", { name: /^Open it/ }).click();
    await expect(page).toHaveURL(/\/ingest\/files\//);
    await expect(page.locator("main#main h1").first()).toContainText(name);
  });

  test("a role without the import actions gets no drop zone", async ({ page }) => {
    await openPortal(page, "viewer");
    await expect(page.locator("main#main")).toBeVisible({ timeout: 30_000 });
    await expect(fileInput(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add files" })).toHaveCount(0);
  });

  test("a near fit asks once, and the next upload with the same headers fits", async ({ page }) => {
    const series = `U${STAMP.slice(0, 3)}`;
    // One column of the built-in die layout is named differently: close, not the same.
    const renamed = DIE_HEADER.replace("Notes", `Remarks ${STAMP}`);
    const first = `near-${STAMP}.csv`;
    const second = `near-again-${STAMP}.csv`;
    await openPortal(page, "admin");

    await upload(page, first, dieCsv(series, [`${STAMP}N1`], renamed));
    // A near fit is never trusted on its own: orrn names the layout it looks like and asks if row 1 has the column names.
    await expect(headerStep(page).getByText(/^This looks like .+\. Is row 1 the column names\?$/)).toBeVisible({ timeout: 60_000 });
    await pickHeaderRow(page, 1);
    await openReview(page, first, "Needs you");
    await expect(decisionBar(page)).toHaveAttribute("data-state", "needs_confirm", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "What changed" })).toBeVisible();
    await decisionBar(page).getByRole("button", { name: "Use this layout" }).click();
    await expect(decisionBar(page)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    await decisionBar(page).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(decisionBar(page)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });

    // The answer is remembered: the same headers now fit on their own, with nothing to check.
    await page.goto("/ingest");
    await upload(page, second, dieCsv(series, [`${STAMP}N2`], renamed));
    const r = await waitInSegment(page, second, "Ready");
    await expect(r.getByRole("button", { name: /^Approve/ })).toBeVisible();
    await expect(r.getByText("Check the layout")).toHaveCount(0);
    await expect(r.getByText(/question/)).toHaveCount(0);
    // Leave nothing approved behind for the next test's merge count.
    await mergeApproved(page);
  });

  test("a weight outside the believable range asks, and the answer restages the row", async ({ page }) => {
    const series = `T${STAMP.slice(0, 3)}`;
    const code = `${STAMP}M`;
    const dieFile = `dies-m-${STAMP}.csv`;
    const bundleFile = `bundles-m-${STAMP}.csv`;
    await openPortal(page, "admin");

    // The section exists first, so the only thing to ask about is the weight.
    await upload(page, dieFile, dieCsv(series, [code]));
    const dieRow = await waitInSegment(page, dieFile, "Ready");
    await dieRow.getByRole("button", { name: /^Approve/ }).click();
    await segment(page, "Approved");
    await expect(row(page, dieFile).getByRole("button", { name: /^Hold/ })).toBeVisible({ timeout: 30_000 });
    await mergeApproved(page);
    await page.goto("/ingest");

    const csv = Buffer.from(
      ["Legacy id,Series,Section code,Quantity,Weight (kg),Length (mm),PO number", `ZB${STAMP}1,${series},${code},10,400,3658,`, `ZB${STAMP}2,${series},${code},10,58.4,3658,`].join("\n"),
    );
    await upload(page, bundleFile, csv);
    await openReview(page, bundleFile, "Needs you");

    // The question names the field, the unit and how many rows; the bar says why Approve is missing.
    const question = page.getByRole("group", { name: /Some Weight values look wrong for kg/ });
    await expect(question).toBeVisible({ timeout: 30_000 });
    await expect(decisionBar(page).getByRole("link", { name: /^Answer \d+ questions? to approve\.$/ })).toBeVisible();
    await expect(decisionBar(page).getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

    // The row that waits has its own explanation, and the filter starts on "Needs a decision".
    await expect(page.getByRole("button", { name: /^Needs a decision \d+/ })).toHaveAttribute("aria-pressed", "true");
    // The row that waits says so in its chip, explains itself in amber, and links to the question.
    const waiting = page.locator("tbody tr").filter({ hasText: "Waits on a question" });
    await expect(waiting.getByText(/looks too large or too small/)).toBeVisible();
    await expect(waiting.getByRole("link", { name: "Answer the question above, or skip the row." })).toBeVisible();

    // "The values are right" saves on a press, the question reads "Answered", and the row no longer waits.
    await question.getByRole("button", { name: "The values are right" }).click();
    await expect(page.getByText(/^Answered: /).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("group", { name: /Some Weight values look wrong for kg/ })).toHaveCount(0);
    await expect(page.locator("tbody tr").filter({ hasText: "looks too large or too small" })).toHaveCount(0);
  });

  test("Approve all approves only the imports with no open question", async ({ page }) => {
    const series = `S${STAMP.slice(0, 3)}`;
    const name = `book-${STAMP}.xlsx`;
    // One workbook, three sheets: two die sheets that fit the built-in layout, and one bundles sheet that has a question
    // (a section orrn does not know and a weight far above the usual).
    const book = XLSX.utils.book_new();
    const dieSheet = (codes: string[]) => XLSX.utils.aoa_to_sheet([DIE_HEADER.split(","), ...dieRows(series, codes).map((line) => line.split(","))]);
    XLSX.utils.book_append_sheet(book, dieSheet([`${STAMP}P1`]), "Sections A");
    XLSX.utils.book_append_sheet(book, dieSheet([`${STAMP}P2`]), "Sections B");
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["Legacy id", "Series", "Section code", "Quantity", "Weight (kg)", "Length (mm)", "PO number"],
        [`ZC${STAMP}1`, "QQ", `${STAMP}Q`, 10, 400, 3658, ""],
      ]),
      "Bundles",
    );
    const buffer = Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Uint8Array);
    await openPortal(page, "admin");
    await upload(page, name, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    await expect(stripRow(page, name).getByText(/^Finished reading\. 3 tables/)).toBeVisible({ timeout: 60_000 });

    // The two die sheets are Ready with no question; the bundles sheet is under Needs you.
    await expect(async () => {
      await segment(page, "Ready");
      await expect(fileRows(page, name)).toHaveCount(2, { timeout: 1_000 });
    }).toPass({ timeout: 90_000 });
    await segment(page, "Needs you");
    await expect(fileRows(page, name)).toHaveCount(1);
    await segment(page, "Ready");

    await group(page, name).getByRole("button", { name: /^Approve all 2/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Approve 2$/ }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });

    // Both die sheets are approved; the bundles sheet is not, and the sticky bar counts two.
    await segment(page, "Approved");
    await expect(fileRows(page, name)).toHaveCount(2);
    await expect(page.getByText(/^2 imports approved, /)).toBeVisible();
    await segment(page, "Needs you");
    await expect(fileRows(page, name)).toHaveCount(1);
    await expect(section(page, name).getByText("Bundles in stock")).toBeVisible();

    // Leave nothing approved behind: merge the two.
    await mergeApproved(page);
    await sectionVisible(page, `${STAMP}P1`);
    await sectionVisible(page, `${STAMP}P2`);
    await sectionAbsent(page, `${STAMP}Q`);
  });

  test("a sheet with a two-line letterhead is asked, the person picks the row, and the import goes on", async ({ page }) => {
    const name = `letterhead-${STAMP}.csv`;
    const headers = [`Lh series ${STAMP}`, `Lh profile ${STAMP}`, `Lh low ${STAMP} kg/12ft`, `Lh high ${STAMP} kg/12ft`];
    const csv = Buffer.from(
      ["FourCubes Extrusions,,,", "Old sections, October,,", headers.join(","), "Z1,LH1,1.1,1.4", "Z1,LH2,1.2,1.5"].join("\n"),
    );
    await openPortal(page, "admin");
    await upload(page, name, csv);

    const step = headerStep(page);
    await expect(step.getByRole("heading", { name: "Which row has the column names?" })).toBeVisible({ timeout: 60_000 });
    // The rows are numbered as on the sheet and the reader's guess is selected: one row, and not necessarily the right one
    // (the second letterhead line has two cells, so the reader takes it for the names).
    await expect(step.getByRole("radio", { name: /^Row \d+:/ })).toHaveCount(5);
    await expect(step.getByRole("radio", { name: /^Row \d+:/, checked: true })).toHaveCount(1);
    await expect(step.getByRole("radio", { name: /^Row 3:/ })).not.toBeChecked();
    await expect(step.getByText(/^Table \d of \d/)).toHaveCount(0);
    await step.getByRole("radio", { name: /^Row 3:/ }).check();
    await step.getByRole("button", { name: "Use row 3" }).click();

    // The step goes away and the import goes on: an unknown layout waits for a person, with the picked row as its names.
    await expect(headerStep(page)).toHaveCount(0, { timeout: 60_000 });
    await waitRead(page, name);
    await openReview(page, name, "Needs you");
    await expect(decisionBar(page)).toHaveAttribute("data-state", "needs_shape", { timeout: 30_000 });
    await page.getByRole("button", { name: "Map columns myself" }).click();
    await expect(page.getByText(headers[0]!).first()).toBeVisible();
  });

  test("a sheet whose header is on another row but fits a known layout is read again with no question", async ({ page }) => {
    const series = `R${STAMP.slice(0, 3)}`;
    const name = `wide-letterhead-${STAMP}.csv`;
    // A letterhead as wide as the table: the reader takes it for the header, the server finds the die layout on row 2.
    const letterhead = ["FourCubes", "Unit 2", "Extrusion", "Die list", "Oct", "2026", "Page", "1", "of", "1"].join(",");
    const csv = Buffer.from([letterhead, DIE_HEADER, ...dieRows(series, [`${STAMP}R1`])].join("\n"));
    await openPortal(page, "admin");
    const calls = countPutBlocks(page);
    await upload(page, name, csv);
    await expect(stripRow(page, name).getByText(/^Finished reading\. 1 table: .*Known layout\.$/)).toBeVisible({ timeout: 60_000 });
    await expect(headerStep(page)).toHaveCount(0);
    // The table was sent, the server named the row, the file was read again and the table sent once more.
    expect(calls.count()).toBeGreaterThanOrEqual(2);
    const r = await waitInSegment(page, name, "Ready");
    await expect(r.getByText("Known layout")).toBeVisible();
  });

  test("a second table below a blank row, with only text above, is joined with \"It continues the table above\"", async ({ page }) => {
    const name = `continues-${STAMP}.csv`;
    const headers = [`Cn party ${STAMP}`, `Cn city ${STAMP}`];
    const csv = Buffer.from([headers.join(","), "Shree,Surat", "Om,Rajkot", ",", "Kisan,Vapi", "Jay,Anand"].join("\n"));
    await openPortal(page, "admin");
    await upload(page, name, csv);

    // A table of text only is not "clean" (the row under its names has no number or date), so the first one is asked too. The
    // second, below the blank row, follows an all-text table: the reader cannot tell by its columns that the rows below belong
    // to it, and the person decides.
    await expect(headerStep(page).getByText(/^Table 1 of 2/)).toBeVisible({ timeout: 60_000 });
    await pickHeaderRow(page, 1);
    await expect(headerStep(page).getByRole("button", { name: "It continues the table above" })).toBeVisible({ timeout: 60_000 });
    await headerStep(page).getByRole("button", { name: "It continues the table above" }).click();

    // One table, with the rows of both: the second table did not become an import of its own.
    await expect(stripRow(page, name).getByText(/^Finished reading\. 1 table\b/)).toBeVisible({ timeout: 90_000 });
    await openReview(page, name, "Needs you");
    await expect(page.getByText(/\b5 rows\b/).first()).toBeVisible();
  });

  test("a table with number columns goes on across a blank row by itself, and what was left out is listed", async ({ page }) => {
    const name = `goes-on-${STAMP}.csv`;
    const headers = [`Go series ${STAMP}`, `Go profile ${STAMP}`, `Go low ${STAMP} kg/12ft`, `Go high ${STAMP} kg/12ft`];
    const csv = Buffer.from(
      [headers.join(","), "Z1,GO1,1.1,1.4", "Z1,GO2,1.2,1.5", ",,,", "December,,,", "Z1,GO3,1.3,1.6", "Z1,GO4,1.4,1.7"].join("\n"),
    );
    await openPortal(page, "admin");
    await upload(page, name, csv);
    // One table that goes on by itself: nothing to ask and no offer to join.
    await expect(stripRow(page, name).getByText(/^Finished reading\. 1 table\b/)).toBeVisible({ timeout: 90_000 });
    await expect(headerStep(page)).toHaveCount(0);
    const entry = stripRow(page, name);
    await expect(entry.getByText(/^Finished reading\. 1 table\b/)).toBeVisible({ timeout: 90_000 });
    // Nothing skipped is hidden: the blank row and the month line are listed with their row numbers.
    const listed = entry.getByTestId("left-out");
    await expect(listed.getByText(/^1 blank row inside this table was skipped\.$/)).toBeVisible();
    await expect(listed.getByText(/Row 5 is left out: it looks like a title\. It says: December/)).toBeVisible();
    // The table went on under that title (round 9): it is listed as a section, with its row.
    await expect(listed.getByText(/This table continues under "December" \(row 5\)\./)).toBeVisible();
  });

  test("the read panel lists what the reader left out, and a title can start a new table", async ({ page }) => {
    const name = `sections-${STAMP}.csv`;
    const headers = [`Sc series ${STAMP}`, `Sc profile ${STAMP}`, `Sc low ${STAMP} kg/12ft`, `Sc high ${STAMP} kg/12ft`];
    const csv = Buffer.from([headers.join(","), "Z1,SC1,1.1,1.4", "Z1,SC2,1.2,1.5", ",,,", "December,,,", "Z1,SC3,1.3,1.6", "Z1,SC4,1.4,1.7"].join("\n"));
    await openPortal(page, "admin");
    await upload(page, name, csv);
    await expect(stripRow(page, name).getByText(/^Finished reading\. 1 table\b/)).toBeVisible({ timeout: 90_000 });
    await openReview(page, name, "Needs you");

    // The panel says what was left out and which title the table went on under, with the row number.
    const facts = page.getByTestId("read-facts");
    await expect(facts.getByText(/^1 blank row inside this table was skipped\.$/)).toBeVisible({ timeout: 30_000 });
    await expect(facts.getByText(/Row 5 is left out: it looks like a title\. It says: December/)).toBeVisible();
    await expect(facts.getByText(/This table continues under "December" \(row 5\)\./).first()).toBeVisible();

    // Start a new table here: the file is still in this tab, so it is read again and the tables sent again.
    await facts.getByRole("button", { name: /^Start a new table here/ }).click();
    // The rest of the sheet is a table of its own now, and goes through the header step like any other.
    const step = headerStep(page);
    await expect(step.getByRole("heading", { name: "Which row has the column names?" })).toBeVisible({ timeout: 60_000 });
    // The old import is about to be replaced: none of its buttons is on the page, so the question holds the one main button.
    await expect(page.getByTestId("decision-bar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Map columns myself" })).toHaveCount(0);
    await step.getByRole("button", { name: /^Use row \d+$/ }).click();
    await expect(page.getByText(/^Done\. The tables of this file were read again\./)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("decision-bar")).toHaveCount(0);
  });

  /**
   * An order book with one order (41) that has two dates and blank dates under each, among dated lines of other orders (so the
   * helper's sample check passes). The helper maps it, the year is saved, and the fill question comes.
   */
  async function fillBook(page: Page, request: APIRequestContext, tag: string) {
    const party = await makeParty(page, `Fill${tag}`);
    const die = (await q<{ items: { series: string; sectionCode: string }[] }>(page, "die.list", { search: "14701", limit: 5 })).items[0]!;
    const head = [`Party ${STAMP}${tag}`, `Order no ${STAMP}${tag}`, `PO ${STAMP}${tag}`, `Date ${STAMP}${tag}`, `Series ${STAMP}${tag}`, `Section ${STAMP}${tag}`, `Baki ${STAMP}${tag} kg`, `Cut ${STAMP}${tag} mm`];
    const col = (n: number) => ({ kind: "columns", cols: [{ col: n, header: head[n] }] });
    const recipe = {
      schemaVersion: 1, target: "orders", headerRow: 0, headerRows: 1,
      match: { headerKey: headerKey(normalizeHeaders(head)), headers: normalizeHeaders(head) },
      fields: [
        { field: "customer", source: col(0), steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
        { field: "oldOrderNo", source: col(1), steps: [{ op: "trim" }] },
        { field: "poNumber", source: col(2), steps: [{ op: "trim" }] },
        { field: "orderDate", source: col(3), steps: [{ op: "date", format: "dmy" }] },
        { field: "series", source: col(4), steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
        { field: "sectionCode", source: col(5), steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
        { field: "bakiKg", source: col(6), steps: [{ op: "number", kind: "mass", unit: "kg" }] },
        { field: "cutLength", source: col(7), steps: [{ op: "number", kind: "length", unit: "mm" }] },
      ],
      filters: [], keys: ["customer", "oldOrderNo", "orderDate"], onExisting: "ask", unclear: [],
    };
    await fakeBot(request, { action: "install", responses: [{ result: { kind: "recipe", recipe } }] });
    const row = (no: string, po: string, d: string, i: number) => `${party.name},${no},${po},${d},${die.series},${die.sectionCode},${100 + i},3658`;
    const others = Array.from({ length: 8 }, (_, i) => row(String(30 + i), `PO-${tag}${i}`, `0${i + 1}/04/2025`, i));
    const name = `fill-${tag}-${STAMP}.csv`;
    await page.goto("/ingest");
    await upload(page, name, Buffer.from([head.join(","), ...others, row("41", `PA${tag}`, "01/05/2023", 0), row("41", "", "", 1), row("41", `PB${tag}`, "01/06/2024", 2), row("41", "", "", 3)].join("\n")));
    await openReview(page, name, "Needs you");
    await page.getByRole("button", { name: "Map columns for me" }).click();
    await expect(decisionBar(page)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    await page.getByLabel(/^Financial year/).selectOption("2025-26");
    await page.getByLabel(/^As on date/).fill("31/03/2026");
    await page.getByRole("button", { name: "Save year" }).click();
    await expect(page.getByTestId("fill-lines")).toBeVisible({ timeout: 90_000 });
  }

  test("the fill question shows the lines that took a date, and Yes lets the order go on", async ({ page, request }) => {
    await openPortal(page, "admin");
    try {
      await fillBook(page, request, "Y");
      // Once for the file, with the lines it filled, and the page counts what it asks (the year was saved: one question).
      const question = page.getByRole("group", { name: /Some lines have no date\. orrn took each one's date from the dated line just above it\. Is that right\?/ });
      await expect(question).toBeVisible();
      await expect(page.getByTestId("fill-lines").getByRole("row")).toHaveCount(3);
      // The bar says what it counts: one question, and the lines that wait on it (never a bare number).
      await expect(decisionBar(page).getByRole("link", { name: /^Before you approve: 1 question to answer and \d+ lines? that wait \(\d+ in all\)\.$/ })).toBeVisible();
      // The long sentence of the waiting lines is said once above the table, not on each row.
      await expect(page.getByTestId("row-group-notes")).toBeVisible();
      await question.getByRole("button", { name: "Yes", exact: true }).click();
      await expect(page.getByText(/^Answered: Yes/)).toBeVisible({ timeout: 30_000 });
      await expect(decisionBar(page).getByRole("button", { name: "Approve", exact: true })).toBeVisible({ timeout: 90_000 });
    } finally {
      await fakeBot(request, { action: "clear" });
    }
  });

  test("No leaves the dateless lines and their order waiting, and 'Skip these lines' lets the rest go on", async ({ page, request }) => {
    await openPortal(page, "admin");
    try {
      await fillBook(page, request, "N");
      await page.getByRole("group", { name: /Some lines have no date/ }).getByRole("button", { name: "No", exact: true }).click();
      // The two dateless lines are refused for their missing date, and the dated lines of that order wait; nothing can be approved.
      const skip = decisionBar(page).getByRole("button", { name: /^Skip these \d+ lines$/ });
      await expect(skip).toBeVisible({ timeout: 90_000 });
      await expect(decisionBar(page).getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await expect(page.getByText(/has no date, so orrn cannot tell which year's order 41/).first()).toBeVisible();
      // Nothing is left to answer, only lines wait: the chip says what it counts.
      await expect(decisionBar(page).getByText(/^\d+ lines wait$/)).toBeVisible();
      await expect(decisionBar(page).getByText(/to answer$/)).toHaveCount(0);
      // It asks first, then skips every such line in one action.
      await skip.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(/^Skip these \d+ lines\?$/)).toBeVisible();
      await dialog.getByRole("button", { name: /^Skip these \d+ lines$/ }).click();
      await expect(dialog).toHaveCount(0, { timeout: 30_000 });
      await expect(skip).toHaveCount(0, { timeout: 90_000 });
      await expect(decisionBar(page).getByRole("button", { name: "Approve", exact: true })).toBeVisible({ timeout: 90_000 });

      // Changing No to Yes brings the skipped lines back, and says so before it does.
      const panel = page.getByRole("list").filter({ hasText: /Some lines have no date/ });
      await panel.getByRole("button", { name: /^Change/ }).click();
      await page.getByRole("group", { name: /Some lines have no date/ }).getByRole("button", { name: "Yes", exact: true }).click();
      const confirm = page.getByRole("dialog");
      await expect(confirm.getByText("Change the answer to Yes?")).toBeVisible();
      await expect(confirm.getByText(/Lines you skipped with .Skip these lines. come back and are checked again\. Lines you skipped one by one stay skipped\./)).toBeVisible();
      await confirm.getByRole("button", { name: "Yes", exact: true }).click();
      await expect(confirm).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByText(/^Answered: Yes/)).toBeVisible({ timeout: 30_000 });
    } finally {
      await fakeBot(request, { action: "clear" });
    }
  });

  test("a table that fits a layout already (saved) can still be joined: 'It continues the table above'", async ({ page }) => {
    const name = `saved-upper-${STAMP}.csv`;
    // The customers layout is all text and fits exactly, so the first table is kept; the rows under the blank row are a table
    // that follows it.
    const csv = Buffer.from(["Name,Phone,Email,GSTIN,Notes", `Saved Upper One ${STAMP},98250 11111,,,`, `Saved Upper Two ${STAMP},98250 22222,,,`, ",,,,", `Saved Upper Three ${STAMP},98250 33333,,,`, `Saved Upper Four ${STAMP},98250 44444,,,`].join("\n"));
    await openPortal(page, "admin");
    await upload(page, name, csv);
    await expect(headerStep(page).getByRole("button", { name: "It continues the table above" })).toBeVisible({ timeout: 60_000 });
    await headerStep(page).getByRole("button", { name: "It continues the table above" }).click();
    await expect(stripRow(page, name).getByText(/^Finished reading\. 1 table\b/)).toBeVisible({ timeout: 90_000 });
    // One import with the rows of both parts, under the known layout.
    const r = await waitInSegment(page, name, "Ready");
    await expect(r.getByText("Known layout")).toBeVisible();
    await openReview(page, name, "Ready");
    await expect(page.getByText(/\b5 rows\b/).first()).toBeVisible();
  });

  test("a value like 007 and a value like 18% arrive in the review rows as written", async ({ page }) => {
    const series = `Q${STAMP.slice(0, 3)}`;
    const code = `${STAMP}V`;
    const name = `as-written-${STAMP}.csv`;
    const row = `${series},${code},1.1,1.4,18%,30,1.5,,active,007`;
    await openPortal(page, "admin");
    await upload(page, name, Buffer.from([DIE_HEADER, row].join("\n")));
    await openReview(page, name, "Ready");
    const cells = page.locator("table tbody");
    await expect(cells.getByText("18%", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(cells.getByText("007", { exact: true }).first()).toBeVisible();
  });

  test("one PO on two orders is shown as a conflict naming both, and nothing waits unseen", async ({ page, request }) => {
    const name = `po-twice-${STAMP}.csv`;
    await openPortal(page, "admin");
    // A customer and a section orrn already has, so the rows are ready and only the conflict is left to say.
    const party = await makeParty(page, "PoTwice");
    const die = (await q<{ items: { series: string; sectionCode: string }[] }>(page, "die.list", { search: "14701", limit: 5 })).items[0]!;
    const customer = party.name;
    const headers = [`Party ${STAMP}`, `Order no ${STAMP}`, `PO ${STAMP}`, `Date ${STAMP}`, `Series ${STAMP}`, `Section ${STAMP}`, `Baki ${STAMP} kg`, `Cut ${STAMP} mm`];
    const csv = Buffer.from(
      [headers.join(","), `${customer},41,PO-${STAMP},01/10/2025,${die.series},${die.sectionCode},100,3658`, `${customer},42,PO-${STAMP},02/10/2025,${die.series},${die.sectionCode},200,3658`].join("\n"),
    );
    const col = (n: number) => ({ kind: "columns", cols: [{ col: n, header: headers[n] }] });
    const recipe = {
      schemaVersion: 1,
      target: "orders",
      headerRow: 0,
      headerRows: 1,
      match: { headerKey: headerKey(normalizeHeaders(headers)), headers: normalizeHeaders(headers) },
      fields: [
        { field: "customer", source: col(0), steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
        { field: "oldOrderNo", source: col(1), steps: [{ op: "trim" }] },
        { field: "poNumber", source: col(2), steps: [{ op: "trim" }] },
        { field: "orderDate", source: col(3), steps: [{ op: "date", format: "dmy" }] },
        { field: "series", source: col(4), steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
        { field: "sectionCode", source: col(5), steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
        { field: "bakiKg", source: col(6), steps: [{ op: "number", kind: "mass", unit: "kg" }] },
        { field: "cutLength", source: col(7), steps: [{ op: "number", kind: "length", unit: "mm" }] },
      ],
      filters: [],
      keys: ["customer", "oldOrderNo", "orderDate"],
      onExisting: "ask",
      unclear: [],
    };
    await fakeBot(request, { action: "install", responses: [{ result: { kind: "recipe", recipe } }] });
    try {
      await upload(page, name, csv);
      await openReview(page, name, "Needs you");
      await page.getByRole("button", { name: "Map columns for me" }).click();
      await expect(decisionBar(page)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });

      // The year of an order book is asked first.
      await page.getByLabel(/^Financial year/).selectOption("2025-26");
      await page.getByLabel(/^As on date/).fill("31/03/2026");
      await page.getByRole("button", { name: "Save year" }).click();
      await expect(page.getByTestId("year-line").getByText(/^Financial year 2025-26/)).toBeVisible({ timeout: 30_000 });

      // Then the two orders that carry one PO are a conflict on both, with words that name the order and the other order.
      const conflict = page.locator("tbody tr").filter({ hasText: /is on old order \d+ and on another order in this sheet/ });
      await expect(conflict.first()).toBeVisible({ timeout: 90_000 });
      await expect(conflict).toHaveCount(2);
      await expect(conflict.first().getByRole("button", { name: /^Skip this row/ })).toBeVisible();
      await expect(decisionBar(page).getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    } finally {
      await fakeBot(request, { action: "clear" });
    }
  });

  test("a PDF is kept and not read", async ({ page }) => {
    const name = `packing-list-${STAMP}.pdf`;
    await openPortal(page, "admin");
    await upload(page, name, Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"), "application/pdf");
    const entry = stripRow(page, name);
    const noStorage = page.getByText(/^PDFs and photos need file storage/);
    // With storage the file is kept and listed under its own heading; with none the upload is refused in the server's words.
    await expect(entry.getByText(/^Kept\. orrn does not read PDFs and photos yet\.$/).or(noStorage).first()).toBeVisible({ timeout: 60_000 });
    if (await noStorage.count()) return;
    const kept = page.getByTestId("kept-files");
    await expect(kept.getByRole("heading", { name: "Kept, not read yet" })).toBeVisible();
    await expect(kept.getByText("Reading PDFs and photos comes in a later release.")).toBeVisible();
    await expect(kept.getByText(name)).toBeVisible();
    await expect(stripRow(page, name).getByRole("link", { name: /^Review/ })).toHaveCount(0);
  });
});
