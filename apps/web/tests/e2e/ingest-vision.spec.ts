import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

import { localPassword, signInViaApi } from "./helpers/accounts";
import { API_URL, WEB_ORIGIN } from "./helpers/ports";

/**
 * Import portal release 2: a PDF read page by page with the vision model, on the local stack with local R2 (the
 * `INGEST_VAULT` binding of `apps/server/wrangler.local.jsonc`) and a scripted model installed through
 * `POST /dev/ingest-bot` (local only, never a model call). The PDF is built here, two synthetic pages; the scripted
 * answers are page 1's table (one row the model rated low) and an empty page 2.
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
const UNSEEN = "9876";
const DENSE_FILE = `vision-dense-${STAMP}.pdf`;
const DENSE_ROWS = Array.from({ length: 130 }, (_, i) => [SERIES, `${STAMP}D${i}`, (1 + i / 100).toFixed(2), (2 + i / 100).toFixed(2), `Dense ${i}`, "40", "2", "", "active", ""]);

const pdfText = (text: string) => text.replace(/[()\\]/g, "");

/** One text line per entry, 14 pt apart, so every value the scripted model answers is in the page text (section 11.5). */
function linesPage(lines: string[]): string {
  return `BT /F1 10 Tf 14 TL 40 800 Td ${lines.map((line) => `(${pdfText(line)}) '`).join(" ")} ET`;
}

/** A dense table: each cell its own text item at its column, `leading` pt apart (a page the browser cuts into bands). */
function gridPage(rows: string[][], size: number, leading: number): string {
  const cells = rows.flatMap((row, r) => row.map((cell, c) => `1 0 0 1 ${20 + c * 57} ${830 - r * leading} Tm (${pdfText(cell)}) Tj`));
  return `BT /F1 ${size} Tf ${cells.join(" ")} ET`;
}

/** A small, valid PDF, one content stream per page (synthetic; offsets computed so the xref is right). */
function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const pageIds: number[] = [];
  const font = 3 + pages.length * 2;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  pages.forEach((stream, i) => {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
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

const candidateIds: string[] = [];

test.afterAll(async () => {
  const api = await request.newContext({ extraHTTPHeaders: { origin: WEB_ORIGIN } });
  try {
    await fakeModel(api, { action: "clear" });
    if (candidateIds.length === 0) return;
    const signIn = await api.post(`${API_URL}/api/auth/sign-in/email`, { data: { email: "owner@orrn.local", password: localPassword() } });
    expect(signIn.ok()).toBe(true);
    for (const candidateId of candidateIds) {
      const got = await api.get(`${API_URL}/trpc/ingest.candidate.get?input=${encodeURIComponent(JSON.stringify({ candidateId }))}`);
      const detail = got.ok() ? ((await got.json()).result.data as { state: string; serverSeq: number }) : null;
      if (detail && detail.state !== "discarded" && detail.state !== "merged") {
        const res = await api.post(`${API_URL}/trpc/ingest.candidate.discard`, { data: { candidateId, expectSeq: detail.serverSeq } });
        expect(res.ok(), `discard answered ${res.status()}: ${await res.text()}`).toBe(true);
      }
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
      // Prompt v3 row objects: each row carries its own confidence.
      // Row 3's width is not in the PDF's text (the PDF says 30), so the digit check marks it (section 11.5).
      { tables: [{ title: "Sections", headers: HEADERS, rows: ROWS.map((cells, i) => ({ cells: i === 2 ? cells.map((c, j) => (j === 5 ? UNSEEN : c)) : cells, confidence: [0.96, 0.5, 0.93][i] })) }] },
      { tables: [] },
    ],
  });
  await openPortal(page);
  await page.locator("input[type='file']").setInputFiles({ name: FILE, mimeType: "application/pdf", buffer: makePdf([linesPage([`Synthetic page one ${STAMP}`, HEADERS.join(" "), ...ROWS.map((r) => r.join(" "))]), linesPage([`Synthetic page two ${STAMP}`])]) });
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
  const candidateId = new URL(page.url()).pathname.split("/").pop() ?? null;
  if (candidateId) candidateIds.push(candidateId);

  const bar = page.getByTestId("decision-bar");
  const check = page.getByTestId("vision-check");
  await expect(check).toBeVisible({ timeout: 30_000 });
  // The page image came back through the signed read route and drew.
  const image = check.getByRole("img", { name: `Page 1 of 2 of ${FILE}` });
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);

  // The row whose digits are not in the PDF's text comes first, its cell marked in words; then the row rated low. The
  // blank Leg cell is marked.
  const rows = check.getByTestId("vision-row");
  await expect(rows.first()).toContainText(CODES[2]!);
  await expect(rows.first()).toHaveAttribute("data-unseen", "true");
  await expect(rows.first().locator("td[data-unseen]")).toContainText(UNSEEN);
  await expect(rows.first()).toContainText("These digits are not in the PDF's text. Check them against the page.");
  await expect(rows.nth(1)).toContainText(CODES[1]!);
  await expect(rows.nth(1)).toContainText("Look first");
  await expect(rows.nth(1).getByText("Blank").first()).toBeVisible();

  // The rows are checked before anything is approved: wait for the check, then Approve waits on the tick.
  await expect(bar).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  const approve = check.getByTestId("vision-approve");
  await expect(approve).toHaveAttribute("aria-disabled", "true");
  await expect(bar.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(bar.getByRole("link", { name: "Tick that you checked the rows against the page, then approve." })).toBeVisible();
  // Playwright will not click an aria-disabled control, so the click is sent straight to it: nothing is approved.
  await approve.dispatchEvent("click");
  await expect(bar).toHaveAttribute("data-state", "ready");

  const tick = check.getByRole("checkbox", { name: "I checked these rows against the page" });
  // A controlled box: it shows the server's answer, so click and wait for it rather than check().
  await tick.click();
  await expect(tick).toBeChecked({ timeout: 30_000 });
  await expect(approve).not.toHaveAttribute("aria-disabled", "true");
  // After the tick the screen still has one Approve, the page check's, after the tick (decision 9).
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(1);
  await expect(bar.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
  await expect(bar.getByText("Checked against the page.")).toBeVisible();
  await approve.click();
  await expect(bar).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
});

test("a dense text PDF page is cut into bands before any call, read band by band, and merged into one table", async ({ page, request: api }) => {
  // 132 text lines (a title, the column names, 130 rows): past bandRowThreshold, so the browser cuts 3 bands of at most
  // bandMaxRows. The scripted answers are band 1, 2 and 3, in order; bands 2 and 3 are one table as wide as band 1's.
  const part = (from: number, to: number) => DENSE_ROWS.slice(from, to).map((cells) => ({ cells, confidence: 0.9 }));
  await fakeModel(api, {
    action: "install",
    responses: [
      { tables: [{ title: "Dense sections", headers: HEADERS, rows: part(0, 44) }] },
      { tables: [{ title: null, headers: HEADERS, rows: part(44, 88) }] },
      { tables: [{ title: null, headers: HEADERS, rows: part(88, 130) }] },
    ],
  });
  const bandCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("ingest.vision.bandTickets")) bandCalls.push(r.postData() ?? "");
  });
  await openPortal(page);
  const pdf = makePdf([gridPage([[`Dense ${STAMP}`], HEADERS, ...DENSE_ROWS], 5, 6)]);
  await page.locator("input[type='file']").setInputFiles({ name: DENSE_FILE, mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: /^Add \d+ files?$/ }).click();

  // The page is read in bands and the file finishes: its one table is an import.
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${API_URL}/trpc/ingest.candidate.list?input=${encodeURIComponent(JSON.stringify({}))}`, { headers: { origin: WEB_ORIGIN } });
        if (!res.ok()) return null;
        const items = (await res.json()).result.data.items as { id: string; fileName: string }[];
        id = items.find((c) => c.fileName === DENSE_FILE)?.id ?? null;
        return id;
      },
      { timeout: 120_000 },
    )
    .not.toBeNull();
  candidateIds.push(id!);
  expect(bandCalls.length).toBeGreaterThan(0);
  // tRPC batches its body as { "0": input }.
  const sent = JSON.parse(bandCalls[0]!) as Record<string, unknown>;
  expect(sent["0"] ?? sent).toMatchObject({ page: 1, bands: 3 });

  // The review lists band 1's rows, then band 2's, then band 3's: one table of 130 rows, none lost or doubled.
  await page.goto(`/ingest/review/${id}`);
  const check = page.getByTestId("vision-check");
  await expect(check).toBeVisible({ timeout: 30_000 });
  const rows = check.getByTestId("vision-row");
  await expect(rows).toHaveCount(130, { timeout: 30_000 });
  await expect(rows.first()).toContainText(`${STAMP}D0`);
  await expect(rows.nth(44)).toContainText(`${STAMP}D44`);
  await expect(rows.nth(88)).toContainText(`${STAMP}D88`);
  await expect(rows.last()).toContainText(`${STAMP}D129`);
  // The whole page image went too, for the check against the page.
  await expect(check.getByTestId("vision-page-image")).toBeVisible({ timeout: 30_000 });
});

test("\"Read this file\" reads a kept PDF back from the vault by range requests, page by page", async ({ page, request: api }) => {
  // Kept first, over the API (begin, the signed PUT, commitRaw, complete), so the file waits on "Read this file".
  await openPortal(page);
  const ctx = page.context().request;
  const call = async <T,>(path: string, input: unknown): Promise<T> => {
    const res = await ctx.post(`${API_URL}/trpc/${path}`, { headers: { origin: WEB_ORIGIN }, data: input });
    expect(res.ok(), `${path} returned ${res.status()}: ${await res.text()}`).toBe(true);
    return (await res.json()).result.data as T;
  };
  const name = `vision-back-${STAMP}.pdf`;
  const pdf = makePdf([linesPage([`Synthetic read back ${STAMP}`, HEADERS.join(" "), ...ROWS.map((r) => r.join(" "))])]);
  const { createHash } = await import("node:crypto");
  const begin = await call<{ artifactId: string; upload: { url: string } | null }>("ingest.artifact.begin", {
    sha256: createHash("sha256").update(pdf).digest("hex"), fileName: name, sizeBytes: pdf.length, contentType: "application/pdf", kind: "pdf_text",
  });
  test.skip(!begin.upload, "no local vault on this stack");
  const put = await ctx.put(begin.upload!.url, { data: pdf, headers: { origin: WEB_ORIGIN, "content-type": "application/pdf" } });
  expect(put.status(), await put.text()).toBe(200);
  await call("ingest.artifact.commitRaw", { artifactId: begin.artifactId });
  await call("ingest.artifact.complete", { artifactId: begin.artifactId });

  await fakeModel(api, { action: "install", responses: [{ tables: [{ title: "Sections", headers: HEADERS, rows: ROWS.map((cells) => ({ cells, confidence: 0.95 })) }] }] });
  const ranged: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/files/ingest/read") && r.request().headers()["range"]) ranged.push(r.status());
  });
  await page.goto(`/ingest/files/${begin.artifactId}`);
  await page.getByRole("button", { name: "Read this file" }).click();
  // Its one page is read and the file finishes: the table is an import of the file.
  const importLink = page.locator('main a[href*="/ingest/review/"]').first();
  await expect(importLink).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("main").getByText(/^3 rows, 1 table, added on /)).toBeVisible();
  // The stored bytes came back in ranges (206), never as one whole download.
  expect(ranged.length).toBeGreaterThan(0);
  expect(ranged.every((s) => s === 206)).toBe(true);
  const candidateId = ((await importLink.getAttribute("href")) ?? "").split("/").pop();
  if (candidateId) candidateIds.push(candidateId);
});
