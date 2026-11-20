import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

import { localPassword, signInViaApi } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * Import portal release 2: a PDF read page by page with the vision model, on the local stack with local R2 (the
 * `INGEST_VAULT` binding of `apps/server/wrangler.local.jsonc`) and a scripted model installed through
 * `POST /dev/ingest-bot` (local only, never a model call). The PDF is built here, two synthetic pages; the scripted
 * answers are page 1's table (one row the model is not sure of) and an empty page 2.
 *
 *   upload -> pages read (page 2 not read) -> the file page skips page 2 and finishes -> the review shows the page
 *   image and the doubted row first -> Approve waits until the tick -> tick -> approve.
 *
 * The scripted client is a global of the API worker: it is cleared in afterAll, so `ingest.spec.ts` ("a PDF is kept and
 * not read") still sees the kept path. The two specs are in different e2e groups and never run at the same time. The
 * import made here is discarded in afterAll, so no later merge writes it.
 */

test.describe.configure({ mode: "serial", timeout: 180_000 });

const STAMP = Date.now().toString(36).toUpperCase().slice(-5);
const SERIES = `V${STAMP.slice(0, 3)}`;
const CODES = [`${STAMP}V1`, `${STAMP}V2`, `${STAMP}V3`];
// The die template's own column names, so the table fits the known layout and needs no helper.
const HEADERS = ["Series", "Section code", "Min weight (kg/12ft)", "Max weight (kg/12ft)", "Name", "Width (mm)", "Thickness (mm)", "Leg (mm)", "Status", "Notes"];
const ROWS = CODES.map((code, i) => [SERIES, code, (1.1 + i / 10).toFixed(1), (1.4 + i / 10).toFixed(1), `Vision test ${code}`, "30", "1.5", "", "active", ""]);
const FILE = `vision-${STAMP}.pdf`;

/** A small, valid PDF with one line of text per page (synthetic; offsets computed so the xref is right). */
function makePdf(lines: string[]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  const font = 3 + lines.length * 2;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  lines.forEach((line, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = `BT /F1 16 Tf 72 760 Td (${line.replace(/[()\\]/g, "")}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${lines.length} >>`;
  objects[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function fakeModel(api: APIRequestContext, body: unknown) {
  const res = await api.post(`${API_URL}/dev/ingest-bot`, { data: body });
  expect(res.ok(), `/dev/ingest-bot answered ${res.status()}`).toBe(true);
}

let candidateId: string | null = null;

test.afterAll(async () => {
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    await fakeModel(api, { action: "clear" });
    if (!candidateId) return;
    const signIn = await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email: "owner@orrn.local", password: localPassword() } });
    expect(signIn.ok()).toBe(true);
    const got = await api.get(`${API_URL}/trpc/ingest.candidate.get?input=${encodeURIComponent(JSON.stringify({ candidateId }))}`);
    const detail = got.ok() ? ((await got.json()).result.data as { state: string; serverSeq: number }) : null;
    if (detail && detail.state !== "discarded" && detail.state !== "merged") {
      const res = await api.post(`${API_URL}/trpc/ingest.candidate.discard`, { data: { candidateId, expectSeq: detail.serverSeq } });
      expect(res.ok(), `discard answered ${res.status()}: ${await res.text()}`).toBe(true);
    }
  } finally {
    await api.dispose();
  }
});

async function openPortal(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await signInViaApi(page, "admin");
  await page.goto("/ingest");
  await expect(page.locator("main#main h1").first()).toBeVisible({ timeout: 30_000 });
}

test("a PDF is read page by page, checked against its page, then approved", async ({ page, request: api }) => {
  await fakeModel(api, {
    action: "install",
    responses: [
      { tables: [{ title: "Sections", headers: HEADERS, rows: ROWS, rowConfidence: [0.96, 0.5, 0.93] }] },
      { tables: [] },
    ],
  });
  await openPortal(page);
  // With storage and a model the drop hint says PDFs and photos are read.
  await expect(page.getByText(/PDFs and photos are read page by page/).first()).toBeVisible();

  await page.locator("input[type='file']").setInputFiles({ name: FILE, mimeType: "application/pdf", buffer: makePdf([`Synthetic page one ${STAMP}`, `Synthetic page two ${STAMP}`]) });
  await page.getByRole("button", { name: /^Add \d+ files?$/ }).click();

  // Page 1 is read; page 2 has no table, so the strip sends the person to the file page.
  const strip = page.locator("li[data-step]", { hasText: FILE });
  await expect(strip.getByText("1 page is not read. Open the file to read, type or skip it.")).toBeVisible({ timeout: 90_000 });
  await strip.getByRole("link", { name: `Open it: ${FILE}` }).click();
  await expect(page).toHaveURL(/\/ingest\/files\//);

  const pages = page.getByTestId("vision-pages");
  await expect(pages.getByRole("heading", { name: "Pages" })).toBeVisible({ timeout: 30_000 });
  const page1 = pages.getByTestId("vision-page").nth(0);
  const page2 = pages.getByTestId("vision-page").nth(1);
  await expect(page1).toHaveAttribute("data-state", "read");
  await expect(page1.getByText("1 table")).toBeVisible();
  await expect(page2).toHaveAttribute("data-state", "not_read");
  await expect(page2.getByText("No table found on this page.")).toBeVisible();

  await page2.getByRole("button", { name: "Skip this page, page 2" }).click();
  await expect(page2).toHaveAttribute("data-state", "skipped", { timeout: 30_000 });
  await pages.getByRole("button", { name: "Finish" }).click();

  // The file is read: its table is one import on the file page. Open it.
  const importLink = page.locator('main a[href*="/ingest/review/"]').first();
  await expect(importLink).toBeVisible({ timeout: 60_000 });
  await importLink.click();
  await expect(page).toHaveURL(/\/ingest\/review\//);
  candidateId = new URL(page.url()).pathname.split("/").pop() ?? null;

  const bar = page.getByTestId("decision-bar");
  const check = page.getByTestId("vision-check");
  await expect(check).toBeVisible({ timeout: 30_000 });
  // The page image came back through the signed read route and drew.
  const image = check.getByRole("img", { name: `Page 1 of 2 of ${FILE}` });
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);

  // The row the model was not sure of comes first, marked in words; the blank Leg cell is marked.
  const first = check.getByTestId("vision-row").first();
  await expect(first).toContainText(CODES[1]!);
  await expect(first).toContainText("Not sure");
  await expect(first.getByText("Blank").first()).toBeVisible();

  // The rows are checked before anything is approved: wait for the check, then Approve waits on the tick.
  await expect(bar).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  const approve = check.getByTestId("vision-approve");
  await expect(approve).toHaveAttribute("aria-disabled", "true");
  await expect(bar.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(bar.getByRole("link", { name: "Tick that you checked the rows against the page, then approve." })).toBeVisible();
  await approve.click();
  await expect(bar).toHaveAttribute("data-state", "ready");

  const tick = check.getByRole("checkbox", { name: "I checked these rows against the page" });
  // A controlled box: it shows the server's answer, so click and wait for it rather than check().
  await tick.click();
  await expect(tick).toBeChecked({ timeout: 30_000 });
  await expect(approve).not.toHaveAttribute("aria-disabled", "true");
  await approve.click();
  await expect(bar).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
});
