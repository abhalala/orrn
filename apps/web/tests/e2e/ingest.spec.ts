import { headerKey, normalizeHeaders } from "@orrn/ingest";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";
import { API_URL } from "./helpers/ports";

/**
 * Infinity Portal: the browser flow of plan C2, on the local stack.
 *
 *   1. An admin uploads the die template CSV, sees a known layout with no question, approves, merges, and finds the
 *      sections in the catalog.
 *   2. A second sheet with unknown headers goes through the helper (a scripted shape client installed through
 *      `POST /dev/ingest-bot`, local only, never a model call), the person reviews and approves, and merges.
 *   3. A held candidate stays out of the merge.
 *   4. The same file uploaded twice opens the first upload.
 *   5. A role without the import actions gets no drop zone.
 *
 * Every file is made fresh per run: its series and section codes carry a run stamp, so a second run never meets the
 * first run's sections, and no other spec's data is touched. Tests run one after another because a merge writes every
 * approved candidate of the plant.
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const STAMP = Date.now().toString(36).toUpperCase().slice(-5);
const DIE_HEADER = "Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft),Name,Width (mm),Thickness (mm),Leg (mm),Status,Notes";

function dieCsv(series: string, codes: string[]): Buffer {
  const rows = codes.map((code, i) => `${series},${code},${(1.1 + i / 10).toFixed(1)},${(1.4 + i / 10).toFixed(1)},Ingest test ${code},30,1.5,,active,`);
  return Buffer.from([DIE_HEADER, ...rows].join("\n"));
}

async function openPortal(page: Page, role: LocalRole) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto("/ingest");
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
}

const fileInput = (page: Page) => page.locator("input[type='file']");
const card = (page: Page, fileName: string): Locator => page.locator("[data-testid='ingest-candidate']", { hasText: fileName });

async function upload(page: Page, name: string, buffer: Buffer) {
  await fileInput(page).setInputFiles({ name, mimeType: "text/csv", buffer });
}

async function waitForState(page: Page, fileName: string, state: string, timeout = 90_000) {
  await expect(card(page, fileName)).toHaveAttribute("data-state", state, { timeout });
}

async function mergeApproved(page: Page, count: number) {
  await page.goto("/ingest");
  await page.getByRole("button", { name: new RegExp(`Merge ${count} approved`) }).click();
  await expect(page).toHaveURL(/\/ingest\/merge\//, { timeout: 30_000 });
  await expect(page.getByText(/^\d+ added and \d+ updated in orrn\.$/).first()).toBeVisible({ timeout: 120_000 });
}

async function sectionVisible(page: Page, code: string) {
  await page.goto(`/dies?q=${encodeURIComponent(code)}`);
  await expect(page.getByText(code).first()).toBeVisible({ timeout: 30_000 });
}

async function sectionAbsent(page: Page, code: string) {
  await page.goto(`/dies?q=${encodeURIComponent(code)}`);
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(code)).toHaveCount(0, { timeout: 10_000 });
}

async function fakeBot(request: APIRequestContext, body: unknown) {
  const res = await request.post(`${API_URL}/dev/ingest-bot`, { data: body });
  expect(res.ok(), `/dev/ingest-bot answered ${res.status()}`).toBe(true);
}

test.describe("imports portal", () => {
  test("an admin reads the die template, sees a known layout, approves and merges", async ({ page }) => {
    const series = `Z${STAMP.slice(0, 3)}`;
    const codes = [`${STAMP}1`, `${STAMP}2`, `${STAMP}3`];
    const name = `dies-${STAMP}.csv`;
    await openPortal(page, "admin");

    await upload(page, name, dieCsv(series, codes));
    const c = card(page, name);
    await expect(c).toBeVisible({ timeout: 60_000 });
    // The layout is known, so there is no model call and no question: the rows are checked and it is ready.
    await expect(c.getByText("Known layout")).toBeVisible();
    await expect(c.getByText("Sections", { exact: true }).first()).toBeVisible();
    await waitForState(page, name, "ready");
    await expect(c.getByText(/^Needs you/)).toHaveCount(0);

    await c.getByRole("button", { name: "Approve" }).click();
    await waitForState(page, name, "approved", 30_000);

    await mergeApproved(page, 1);
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
      await waitForState(page, name, "needs_shape", 60_000);
      await expect(card(page, name).getByText("New layout")).toBeVisible();

      // Open it and ask the helper.
      await card(page, name).getByRole("link").first().click();
      await expect(page).toHaveURL(/\/ingest\/review\//);
      await page.getByRole("button", { name: "Map columns for me" }).click();
      await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible({ timeout: 90_000 });
      // The person reviews the proposed mapping through the staged row and approves.
      await expect(page.locator("table").getByText(code).first()).toBeVisible();
      await page.getByRole("button", { name: "Approve" }).first().click();
      await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

      await mergeApproved(page, 1);
      await sectionVisible(page, code);
    } finally {
      await fakeBot(request, { action: "clear" });
    }
  });

  test("a held candidate stays out of the merge", async ({ page }) => {
    const seriesA = `X${STAMP.slice(0, 3)}`;
    const seriesB = `W${STAMP.slice(0, 3)}`;
    const a = `${STAMP}A`;
    const b = `${STAMP}B`;
    const nameA = `approve-${STAMP}.csv`;
    const nameB = `hold-${STAMP}.csv`;
    await openPortal(page, "admin");
    await upload(page, nameA, dieCsv(seriesA, [a]));
    await waitForState(page, nameA, "ready");
    await upload(page, nameB, dieCsv(seriesB, [b]));
    await waitForState(page, nameB, "ready");

    await card(page, nameA).getByRole("button", { name: "Approve" }).click();
    await waitForState(page, nameA, "approved", 30_000);
    await card(page, nameB).getByRole("button", { name: "Hold" }).click();
    await waitForState(page, nameB, "held", 30_000);

    await mergeApproved(page, 1);
    await sectionVisible(page, a);
    await sectionAbsent(page, b);
    await page.goto("/ingest");
    await waitForState(page, nameB, "held", 30_000);
  });

  test("the same file uploaded twice opens the first upload", async ({ page }) => {
    const name = `again-${STAMP}.csv`;
    const csv = dieCsv(`V${STAMP.slice(0, 3)}`, [`${STAMP}9`]);
    await openPortal(page, "admin");
    await upload(page, name, csv);
    await expect(card(page, name)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("li[data-step='done']").first()).toBeVisible({ timeout: 60_000 });
    await upload(page, `copy-of-${name}`, csv);
    await expect(page.getByText(/You added this file on .+\./)).toBeVisible({ timeout: 60_000 });
  });

  test("a role without the import actions gets no drop zone", async ({ page }) => {
    await openPortal(page, "viewer");
    await expect(page.locator("main#main")).toBeVisible({ timeout: 30_000 });
    await expect(fileInput(page)).toHaveCount(0);
  });
});
