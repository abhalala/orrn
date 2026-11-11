import { headerKey, normalizeHeaders } from "@orrn/ingest";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
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
  await expect(stripRow(page, fileName).getByText(/^Read\. \d+ tables?/)).toBeVisible({ timeout: 60_000 });
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
  await expect(page.getByText("rows added").first()).toBeVisible();
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

test.describe("imports portal", () => {
  test("an admin reads the die template, sees a known layout, approves and merges", async ({ page }) => {
    const series = `Z${STAMP.slice(0, 3)}`;
    const codes = [`${STAMP}1`, `${STAMP}2`, `${STAMP}3`];
    const name = `dies-${STAMP}.csv`;
    await openPortal(page, "admin");

    await upload(page, name, dieCsv(series, codes));
    // The layout is known, so there is no model call and no question: the strip says what was found.
    await expect(stripRow(page, name).getByText(/^Read\. 1 table: .*Known layout\.$/)).toBeVisible({ timeout: 60_000 });

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
    await expect(stripRow(page, name).getByText(/^Read\. 3 tables/)).toBeVisible({ timeout: 60_000 });

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
});
