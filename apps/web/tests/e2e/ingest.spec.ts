import { expect, test, type Page } from "@playwright/test";

import { signInViaApi, type LocalRole } from "./helpers/accounts";

/**
 * Infinity Portal (plan C2, lane E): upload the die template CSV, see a known layout, approve, merge, see the
 * sections. Written against the routes and role names of plan B9 and the English words of plan B10:
 * `/ingest`, `/ingest/review/$candidateId`, `/ingest/merge/$runId`; owner and admin hold `ingest.upload` and
 * `ingest.merge`, every other role gets the shared no-access state.
 *
 * STATUS: written against the contract, NOT RUN. Lane E2's screens were not on this branch when the spec was
 * written (see PORTAL-E1-REPORT.md). Selectors are role and visible name only; if E2 words something differently
 * from B10 the dictionary is the source of truth.
 *
 * The file is made fresh per run: its section codes carry a run stamp, so a second run never meets the first
 * run's sections (no "Already in orrn" rows) and no other spec's data is touched.
 */

const STAMP = Date.now().toString(36).toUpperCase().slice(-5);
const SERIES = `Z${STAMP.slice(0, 3)}`;
const CODES = [`${STAMP}1`, `${STAMP}2`, `${STAMP}3`];

function dieCsv(): Buffer {
  const header = "Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft),Name,Width (mm),Thickness (mm),Leg (mm),Status,Notes";
  const rows = CODES.map((code, i) => `${SERIES},${code},${(1.1 + i / 10).toFixed(1)},${(1.4 + i / 10).toFixed(1)},Ingest test ${code},30,1.5,,active,`);
  return Buffer.from([header, ...rows].join("\n"));
}

async function openPortal(page: Page, role: LocalRole) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, role);
  await page.goto("/ingest");
}

test.describe("imports portal", () => {
  test("an admin reads the die template, sees a known layout, approves and merges", async ({ page }) => {
    await openPortal(page, "admin");
    await expect(page.getByRole("heading", { name: "Imports", level: 1 })).toBeVisible({ timeout: 20_000 });

    await page.locator("input[type='file']").setInputFiles({ name: `dies-${STAMP}.csv`, mimeType: "text/csv", buffer: dieCsv() });

    // The file is read and saved; its one candidate is a known layout for sections.
    const card = page.getByRole("link", { name: new RegExp(`dies-${STAMP}`) }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Known layout").first()).toBeVisible();
    await expect(page.getByText("Sections").first()).toBeVisible();

    // Open it. The dry run finishes by itself (this tab pumps it), then the candidate is ready.
    await card.click();
    await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    // Three new rows, no question.
    await expect(page.getByText("New", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

    // Back on the list, one button merges everything approved.
    await page.goto("/ingest");
    await page.getByRole("button", { name: /Merge 1 approved/ }).click();
    await expect(page).toHaveURL(/\/ingest\/merge\//);
    await expect(page.getByText(/Merged\. 3 added, 0 updated\./)).toBeVisible({ timeout: 60_000 });

    // The sections now exist.
    await page.goto("/dies");
    await page.getByRole("searchbox").first().fill(CODES[0]!);
    await expect(page.getByText(CODES[0]!).first()).toBeVisible({ timeout: 20_000 });
  });

  test("the same file again opens the first upload", async ({ page }) => {
    await openPortal(page, "admin");
    await expect(page.getByRole("heading", { name: "Imports", level: 1 })).toBeVisible({ timeout: 20_000 });
    const file = { name: `dies-again-${STAMP}.csv`, mimeType: "text/csv", buffer: Buffer.from(`Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft)\n${SERIES},${STAMP}9,1.1,1.4\n`) };
    await page.locator("input[type='file']").setInputFiles(file);
    await expect(page.getByRole("link", { name: new RegExp(`dies-again-${STAMP}`) }).first()).toBeVisible({ timeout: 30_000 });
    await page.locator("input[type='file']").setInputFiles(file);
    await expect(page.getByText(/You uploaded this file on .+\. Opening it\./)).toBeVisible({ timeout: 20_000 });
  });

  test("a role without the import actions gets no drop zone", async ({ page }) => {
    await openPortal(page, "viewer");
    await expect(page.locator("main#main")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("input[type='file']")).toHaveCount(0);
  });

  // A second file with a layout orrn does not know goes through the helper. The server test seed has to set the
  // fake shape client (`setShapeClientForTests`); no seed switch for it exists on this branch yet.
  test.fixme("a new layout goes through the helper and reaches Ready", async () => {
    // Upload a sheet with unknown headers, click "Map columns for me", wait for "Ready".
  });
});
