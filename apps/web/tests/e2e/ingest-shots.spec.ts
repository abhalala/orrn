import { headerKey, normalizeHeaders } from "@orrn/ingest";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi } from "./helpers/accounts";
import { makeParty, q } from "./helpers/orders-api";
import { API_URL } from "./helpers/ports";

/**
 * Screenshots of the Imports screens for the design review (not a test of behaviour). Run by hand with SHOTS=1.
 * Every stage is its own try block: one that fails is logged ("STAGE FAILED") and the next one still runs.
 * SKIP_STAGES=a,b leaves stages out.
 */
test.skip(!process.env.SHOTS, "set SHOTS=1");
test.describe.configure({ mode: "serial", timeout: 2_400_000 });

const OUT = "/Users/abhalala/Documents/business/fc/.unslop-build/platform/portal-shots-3";
const STAMP = Date.now().toString(36).toUpperCase().slice(-5);
const SKIP = new Set((process.env.SKIP_STAGES ?? "").split(",").filter(Boolean));
const DIE_HEADER = "Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft),Name,Width (mm),Thickness (mm),Leg (mm),Status,Notes";
const dieRows = (series: string, codes: string[]) => codes.map((c, i) => `${series},${c},${(1.1 + i / 10).toFixed(1)},${(1.4 + i / 10).toFixed(1)},Shot ${c},30,1.5,,active,`);
const dieCsv = (series: string, codes: string[], header = DIE_HEADER) => Buffer.from([header, ...dieRows(series, codes)].join("\n"));

type Mode = { width: 1280 | 820 | 375; locale: "en" | "hi"; dark: boolean };
const ALL_MODES: Mode[] = [
  { width: 1280, locale: "en", dark: false },
  { width: 1280, locale: "hi", dark: false },
  { width: 375, locale: "en", dark: false },
  { width: 375, locale: "hi", dark: false },
  { width: 1280, locale: "en", dark: true },
  { width: 375, locale: "en", dark: true },
];

/** SHOT_MODES=hidark: Hindi dark at both widths. SHOT_MODES=w820: 820 px, English and Hindi, light. Default: the main set. */
const MODES: Mode[] =
  process.env.SHOT_MODES === "hidark"
    ? [{ width: 1280, locale: "hi", dark: true }, { width: 375, locale: "hi", dark: true }]
    : process.env.SHOT_MODES === "w820"
      ? ([{ width: 820, locale: "en", dark: false }, { width: 820, locale: "hi", dark: false }] as unknown as Mode[])
      : ALL_MODES;

async function setMode(page: Page, m: Mode) {
  await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), m.locale);
  await page.emulateMedia({ colorScheme: m.dark ? "dark" : "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: m.width, height: m.width === 375 ? 812 : m.width === 820 ? 1100 : 900 });
}
const modeName = (m: Mode) => `${m.width}-${m.locale}${m.dark ? "-dark" : ""}`;
async function snap(page: Page, name: string, m: Mode) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}-${modeName(m)}.png`, fullPage: true });
}
/** A URL page in every mode. `ready` waits for what the shot is of. */
async function shootUrl(page: Page, name: string, url: string, ready: () => Promise<unknown>) {
  for (const m of MODES) {
    await setMode(page, m);
    await page.goto(url);
    await ready();
    await snap(page, name, m);
  }
}
/** An in-memory state (the header step): the same file is added again in each mode, with a name that makes its bytes new. */
async function shootLive(page: Page, name: string, csvFor: (tag: string) => Buffer, drive: () => Promise<unknown>) {
  for (const m of MODES) {
    await setMode(page, m);
    await page.goto("/ingest");
    await page.locator("input[type='file']").setInputFiles({ name: `${name}-${modeName(m)}-${STAMP}.csv`, mimeType: "text/csv", buffer: csvFor(modeName(m)) });
    await page.getByRole("button", { name: /^Add \d+ files?$|^\d+ फ़ाइल/ }).click();
    await drive();
    await snap(page, name, m);
  }
}
let shotPage: Page | null = null;
async function stage(name: string, fn: () => Promise<unknown>) {
  if (SKIP.has(name)) return;
  try {
    await fn();
    console.log(`STAGE OK ${name}`);
  } catch (error) {
    console.log(`STAGE FAILED ${name}: ${String(error).slice(0, 300)}`);
    await shotPage?.screenshot({ path: `/private/tmp/claude-501/-Users-abhalala-Documents-business-fc/a1292c21-af85-40f3-b78f-035cb9d71412/scratchpad/fail-${name}.png`, fullPage: true }).catch(() => undefined);
  }
}

const step = (page: Page) => page.getByTestId("header-step");
const bar = (page: Page) => page.getByTestId("decision-bar");
const ROW1 = /^(Row|लाइन) 1:/;

async function upload(page: Page, name: string, buffer: Buffer, mimeType = "text/csv") {
  await page.locator("input[type='file']").setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: /^Add \d+ files?$|^\d+ फ़ाइल/ }).click();
}
async function readDone(page: Page, name: string) {
  await expect(page.locator("li[data-step]", { hasText: name }).getByText(/^Read\. \d+ tables?|^पढ़ ली/)).toBeVisible({ timeout: 90_000 });
}
/** The review link of a file's import, once it has left "Checking rows". */
async function reviewHref(page: Page, name: string): Promise<string> {
  for (let tries = 0; tries < 45; tries += 1) {
    await setMode(page, MODES[0]!);
    await page.goto("/ingest");
    for (const seg of ["Needs you", "Ready", "Approved", "Merged"]) {
      await page.getByRole("radio", { name: new RegExp(`^${seg} `) }).click();
      const link = page.locator("tbody tr", { hasText: name }).getByRole("link").first();
      if (await link.count()) return (await link.getAttribute("href"))!;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`no row for ${name}`);
}
async function fakeBot(page: Page, body: unknown) {
  expect((await page.context().request.post(`${API_URL}/dev/ingest-bot`, { data: body })).ok()).toBe(true);
}

test("shots", async ({ page, request }) => {
  await request.post(`${API_URL}/dev/seed`);
  await signInViaApi(page, "admin");
  shotPage = page;
  const urls: Record<string, string> = {};

  // Upload, nothing yet.
  await stage("upload", async () => shootUrl(page, "upload-empty", "/ingest", () => page.locator("main#main h1").first().waitFor()));

  // The header question, with its preview.
  const lh = [`Lh series ${STAMP}`, `Lh profile ${STAMP}`, `Lh low ${STAMP} kg/12ft`, `Lh high ${STAMP} kg/12ft`];
  const letterhead = (tag: string) => Buffer.from(["FourCubes Extrusions,,,", "Old sections, October,,", lh.join(","), `Z1,LH1${tag},1.1,1.4`, "Z1,LH2,1.2,1.5"].join("\n"));
  await stage("header-question", () => shootLive(page, "header-question", letterhead, () => step(page).waitFor({ timeout: 60_000 })));
  await stage("header-two-rows", () =>
    shootLive(page, "header-two-rows", letterhead, async () => {
      await step(page).waitFor({ timeout: 60_000 });
      await step(page).getByRole("radio", { name: /^(Row|लाइन) 3:/ }).check();
      await step(page).getByRole("radio", { name: /Two rows|दो लाइनें/ }).check();
    }),
  );

  // A clean sheet goes straight to "needs a layout": no question.
  const cleanH = [`Cl series ${STAMP}`, `Cl profile ${STAMP}`, `Cl low ${STAMP} kg/12ft`, `Cl high ${STAMP} kg/12ft`];
  await stage("clean-sheet", async () => {
    for (const m of MODES) {
      await setMode(page, m);
      await page.goto("/ingest");
      const name = `clean-${modeName(m)}-${STAMP}.csv`;
      await upload(page, name, Buffer.from([cleanH.join(","), `Z1,CL${modeName(m)},1.1,1.4`, "Z1,CL2,1.2,1.5"].join("\n")));
      await readDone(page, name);
      await expect(step(page)).toHaveCount(0);
      await snap(page, "clean-sheet-straight-to-layout", m);
    }
  });

  // Near fit: the question names the layout it looks like.
  const renamed = DIE_HEADER.replace("Notes", `Remarks ${STAMP}`);
  await stage("near-fit", () => shootLive(page, "header-near-fit", (tag) => dieCsv(`H${STAMP.slice(0, 3)}`, [`${STAMP}${tag.length}${tag.replace(/\W/g, "")}`], renamed), () => step(page).getByText(/^(This looks like|यह .+ जैसा लगता है)/).waitFor({ timeout: 60_000 })));

  // Several tables in one sheet, and "It continues the table above".
  const text = [`Sv party ${STAMP}`, `Sv city ${STAMP}`];
  const twoTables = (tag: string) => Buffer.from([text.join(","), `Shree${tag},Surat`, "Om,Rajkot", ",", "Party,Order,Kg,Date", "Shree,41,10,2026-10-01", "Om,42,20,2026-10-02"].join("\n"));
  await stage("several-tables", () => shootLive(page, "header-several-tables", twoTables, () => step(page).getByText(/Table 1 of|टेबल 1/).or(step(page)).first().waitFor({ timeout: 60_000 })));
  const continues = (tag: string) => Buffer.from([text.join(","), `Shree${tag},Surat`, "Om,Rajkot", ",", "Kisan,Vapi", "Jay,Anand"].join("\n"));
  await stage("continues-above", () => shootLive(page, "header-continues-above", continues, () => step(page).getByRole("button", { name: /It continues the table above|यह ऊपर की टेबल का ही हिस्सा है/ }).waitFor({ timeout: 60_000 })));

  // Kept, not read: a PDF and a photo (the local plant has no storage, so the list answer carries them).
  await stage("kept", async () => {
    await page.route("**/trpc/ingest.artifact.list*", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const first = Array.isArray(body) ? body[0] : body;
      const items = first?.result?.data?.json?.items ?? first?.result?.data?.items;
      const mk = (id: string, fileName: string, kind: string, sizeBytes: number, createdAt: number) => ({
        id, sha256: id.repeat(8), fileName, contentType: null, kind, sizeBytes, vaultState: "stored", readState: "kept_unread", readError: null,
        blockCount: 0, rowCount: 0, period: null, periodConfirmed: null, note: null, uploadedBy: null, createdAt,
      });
      if (Array.isArray(items)) items.push(mk("kp1", "Packing list Oct-25.pdf", "pdf_text", 482_113, Date.now() - 86_400_000), mk("kp2", "Stock register page 4.jpg", "image", 2_400_000, Date.now() - 3 * 86_400_000));
      await route.fulfill({ response: res, json: body });
    });
    await shootUrl(page, "kept-not-read", "/ingest", () => page.getByTestId("kept-files").waitFor({ timeout: 30_000 }));
    await page.unroute("**/trpc/ingest.artifact.list*");
  });

  // The read panel with gaps, a skipped title and a section, and "Start a new table here".
  const nums = [`Go series ${STAMP}`, `Go profile ${STAMP}`, `Go low ${STAMP} kg/12ft`, `Go high ${STAMP} kg/12ft`];
  await stage("read-panel", async () => {
    const name = `goes-on-${STAMP}.csv`;
    await setMode(page, MODES[0]!);
    await page.goto("/ingest");
    await upload(page, name, Buffer.from([nums.join(","), "Z1,GO1,1.1,1.4", "Z1,GO2,1.2,1.5", ",,,", "December,,,", "Z1,GO3,1.3,1.6"].join("\n")));
    await readDone(page, name);
    urls.readPanel = await reviewHref(page, name);
    await shootUrl(page, "read-panel-gaps-warnings-sections", urls.readPanel, () => page.getByTestId("read-facts").waitFor({ timeout: 30_000 }));
  });

  // "Start a new table here": the file is still in this tab, so the rest of the sheet comes back as a table with the header question.
  await stage("start-new-table", async () => {
    for (const m of MODES) {
      await setMode(page, m);
      await page.goto("/ingest");
      const name = `new-table-${modeName(m)}-${STAMP}.csv`;
      await upload(page, name, Buffer.from([nums.join(","), `Z1,GO${modeName(m)},1.1,1.4`, "Z1,GO2,1.2,1.5", ",,,", "December,,,", "Z1,GO3,1.3,1.6"].join("\n")));
      await readDone(page, name);
      await page.locator("li[data-step]", { hasText: name }).getByRole("link", { name: /^(Review|देखें)/ }).click();
      await page.getByTestId("read-facts").getByRole("button", { name: /^(Start a new table here|यहां से नई टेबल शुरू करें)/ }).click();
      // The rest of the sheet is a clean table, so there is no question: the screen says the tables were read again.
      await page.getByTestId("reput-area").waitFor({ timeout: 60_000 });
      await page.waitForTimeout(2500);
      await snap(page, "start-a-new-table-here-done", m);
    }
  });

  // Candidates: a merged die file first, then others that stay ready, approved, held.
  const series = `S${STAMP.slice(0, 3)}`;
  await stage("candidates", async () => {
    await setMode(page, MODES[0]!);
    const approve = async (file: string) => {
      const href = await reviewHref(page, file);
      await page.goto(href);
      await expect(bar(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
      await bar(page).getByRole("button", { name: "Approve", exact: true }).click();
      await expect(bar(page)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
      return href;
    };
    const first = `dies-merged-${STAMP}.csv`;
    await page.goto("/ingest");
    await upload(page, first, dieCsv(series, [`${STAMP}M`]));
    await readDone(page, first);
    await approve(first);
    await page.goto("/ingest");
    await page.getByRole("button", { name: /^Merge \d+ approved imports?$/ }).click();
    for (const m of MODES.slice(0, 1)) await snap(page, "merge-confirm", m);
    await page.getByRole("dialog").getByRole("button", { name: /^Merge \d+ approved imports?$/ }).click();
    await expect(page.getByRole("heading", { name: "Merge finished", level: 1 })).toBeVisible({ timeout: 120_000 });
    urls.mergeDone = new URL(page.url()).pathname;
    for (const [key, code] of [["approved", `${STAMP}A`], ["ready", `${STAMP}R`], ["held", `${STAMP}H`]] as const) {
      const file = `dies-${key}-${STAMP}.csv`;
      await page.goto("/ingest");
      await upload(page, file, dieCsv(series, [code]));
      await readDone(page, file);
    }
    urls.approved = await approve(`dies-approved-${STAMP}.csv`);
    urls.held = await reviewHref(page, `dies-held-${STAMP}.csv`);
    await page.goto(urls.held);
    await expect(bar(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    await bar(page).getByRole("button", { name: "Hold", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Hold", exact: true }).click();
    await expect(bar(page)).toHaveAttribute("data-state", "held", { timeout: 30_000 });
    urls.ready = await reviewHref(page, `dies-ready-${STAMP}.csv`);
    await shootUrl(page, "candidates-list", "/ingest", () => page.locator("main#main h1").first().waitFor({ timeout: 30_000 }));
    await shootUrl(page, "review-ready", urls.ready, () => expect(bar(page)).toBeVisible({ timeout: 30_000 }));
    await shootUrl(page, "review-hold", urls.held, () => expect(bar(page)).toBeVisible({ timeout: 30_000 }));
    await shootUrl(page, "merge-result", urls.mergeDone, () => page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 }));
  });

  // Merge with one failed, back to Hold: two files with the same new section, both approved.
  await stage("merge-with-hold", async () => {
    await setMode(page, MODES[0]!);
    const code = `${STAMP}X`;
    const names = [`dup-a-${STAMP}.csv`, `dup-b-${STAMP}.csv`];
    for (const n of names) {
      await page.goto("/ingest");
      // The same section in both, with another name each: two files with the same bytes would be one file.
      await upload(page, n, Buffer.from(dieCsv(`D${STAMP.slice(0, 3)}`, [code]).toString().replace("Shot", n.slice(0, 5))));
      await readDone(page, n);
    }
    for (const n of names) {
      const href = await reviewHref(page, n);
      await page.goto(href);
      await expect(bar(page)).toHaveAttribute("data-state", /ready|held|approved/, { timeout: 60_000 });
      const approve = bar(page).getByRole("button", { name: "Approve", exact: true });
      if (await approve.count()) await approve.click();
      await page.waitForTimeout(1500);
    }
    await page.goto("/ingest");
    await page.getByRole("button", { name: /^Merge \d+ approved imports?$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Merge \d+ approved imports?$/ }).click();
    await expect(page).toHaveURL(/\/ingest\/merge\//, { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(4000);
    await shootUrl(page, "merge-two-files-same-section", new URL(page.url()).pathname, () => page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 }));
  });

  // A merge where one import fails and goes back to Hold. A real failure needs a server fault, so the merge answer is changed
  // on its way to the page: the last import comes back held with a reason, and the run says it finished with holds.
  await stage("merge-held-mocked", async () => {
    await setMode(page, MODES[0]!);
    const names = [`mh-a-${STAMP}.csv`, `mh-b-${STAMP}.csv`];
    for (const [i, n] of names.entries()) {
      await page.goto("/ingest");
      await upload(page, n, dieCsv(`M${STAMP.slice(0, 3)}`, [`${STAMP}Q${i}`]));
      await readDone(page, n);
    }
    for (const n of names) {
      await page.goto(await reviewHref(page, n));
      await bar(page).getByRole("button", { name: "Approve", exact: true }).click({ timeout: 60_000 });
      await expect(bar(page)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
    }
    await page.goto("/ingest");
    await page.getByRole("button", { name: /^Merge \d+ approved imports?$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Merge \d+ approved imports?$/ }).click();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(3000);
    const url = new URL(page.url()).pathname;
    await page.route("**/trpc/ingest.merge.get*", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const first = Array.isArray(body) ? body[0] : body;
      const data = first?.result?.data?.json ?? first?.result?.data;
      if (data && Array.isArray(data.candidates) && data.candidates.length > 0) {
        const last = data.candidates[data.candidates.length - 1];
        Object.assign(last, { state: "held", reasonCode: "merge_failed", reasonDetail: "Section is already in orrn with other values.", rowsWritten: 0, rowsCreate: 0, rowsUpdate: 0 });
        data.state = "done_with_holds";
      }
      await route.fulfill({ response: res, json: body });
    });
    await shootUrl(page, "merge-one-back-to-hold", url, () => page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 }));
    await page.unroute("**/trpc/ingest.merge.get*");
  });

  // The fill question: lines with no date took the date of the dated line above, in an order with two dates.
  await stage("fill-question", async () => {
    const party = await makeParty(page, "ShotFill");
    const die = (await q<{ items: { series: string; sectionCode: string }[] }>(page, "die.list", { search: "14701", limit: 5 })).items[0]!;
    const fh = [`Party ${STAMP}F`, `Order no ${STAMP}F`, `PO ${STAMP}F`, `Date ${STAMP}F`, `Series ${STAMP}F`, `Section ${STAMP}F`, `Baki ${STAMP}F kg`, `Cut ${STAMP}F mm`];
    const col = (n: number) => ({ kind: "columns", cols: [{ col: n, header: fh[n] }] });
    const recipe = {
      schemaVersion: 1, target: "orders", headerRow: 0, headerRows: 1,
      match: { headerKey: headerKey(normalizeHeaders(fh)), headers: normalizeHeaders(fh) },
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
    await fakeBot(page, { action: "install", responses: [{ result: { kind: "recipe", recipe } }] });
    try {
      await setMode(page, ALL_MODES[0]!);
      const row = (po: string, d: string, i: number, no = "41") => `${party.name},${no},${po},${d},${die.series},${die.sectionCode},${100 + i},3658`;
      // Plenty of dated lines of other orders, so the helper's sample check passes; then one order with two dates and blanks.
      const others = Array.from({ length: 8 }, (_, i) => row(`PO-${i}`, `0${i + 1}/04/2025`, i, String(30 + i)));
      const name = `fill-${STAMP}.csv`;
      await page.goto("/ingest");
      await upload(page, name, Buffer.from([fh.join(","), ...others, row("PO-A", "01/05/2023", 0), row("", "", 1), row("PO-B", "01/06/2024", 2), row("", "", 3)].join("\n")));
      await readDone(page, name);
      const href = await reviewHref(page, name);
      await page.goto(href);
      await page.getByRole("button", { name: "Map columns for me" }).click();
      await expect(bar(page)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
      await page.getByLabel(/^Financial year/).selectOption("2025-26");
      await page.getByLabel(/^As on date/).fill("31/03/2026");
      await page.getByRole("button", { name: "Save year" }).click();
      await expect(page.getByTestId("fill-lines")).toBeVisible({ timeout: 90_000 });
      await shootUrl(page, "review-fill-question", href, () => page.getByTestId("fill-lines").waitFor({ timeout: 60_000 }));
    } finally {
      await fakeBot(page, { action: "clear" });
    }
  });

  // Review states: near fit confirm, needs layout with the mapping editor, the weight question.
  await stage("review-needs-layout", async () => {
    const name = `unknown-${STAMP}.csv`;
    const h = [`Un series ${STAMP}`, `Un profile ${STAMP}`, `Un low ${STAMP} kg/12ft`, `Un high ${STAMP} kg/12ft`];
    await setMode(page, MODES[0]!);
    await page.goto("/ingest");
    await upload(page, name, Buffer.from([h.join(","), `${series},${STAMP}U,1.2,1.5`].join("\n")));
    await readDone(page, name);
    urls.needs = await reviewHref(page, name);
    await shootUrl(page, "review-needs-layout", urls.needs, () => expect(bar(page)).toBeVisible({ timeout: 30_000 }));
  });
  await stage("review-magnitude", async () => {
    const name = `bundles-${STAMP}.csv`;
    await setMode(page, MODES[0]!);
    await page.goto("/ingest");
    await upload(page, name, Buffer.from(["Legacy id,Series,Section code,Quantity,Weight (kg),Length (mm),PO number", `ZB${STAMP}1,${series},${STAMP}M,10,400,3658,`, `ZB${STAMP}2,${series},${STAMP}M,10,58.4,3658,`].join("\n")));
    await readDone(page, name);
    urls.magnitude = await reviewHref(page, name);
    await shootUrl(page, "review-magnitude-question", urls.magnitude, () => expect(bar(page)).toBeVisible({ timeout: 30_000 }));
  });

  // A PO on two orders in two files: the second shows the conflict naming the first file.
  await stage("conflict-two-files", async () => {
    const party = await makeParty(page, "ShotPo");
    const die = (await q<{ items: { series: string; sectionCode: string }[] }>(page, "die.list", { search: "14701", limit: 5 })).items[0]!;
    const oh = [`Party ${STAMP}`, `Order no ${STAMP}`, `PO ${STAMP}`, `Date ${STAMP}`, `Series ${STAMP}`, `Section ${STAMP}`, `Baki ${STAMP} kg`, `Cut ${STAMP} mm`];
    const col = (n: number) => ({ kind: "columns", cols: [{ col: n, header: oh[n] }] });
    const recipe = {
      schemaVersion: 1, target: "orders", headerRow: 0, headerRows: 1,
      match: { headerKey: headerKey(normalizeHeaders(oh)), headers: normalizeHeaders(oh) },
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
    await fakeBot(page, { action: "install", responses: [{ result: { kind: "recipe", recipe } }] });
    try {
      await setMode(page, MODES[0]!);
      const row = (no: string, d: string) => `${party.name},${no},PO-${STAMP},${d},${die.series},${die.sectionCode},100,3658`;
      const one = `orders-one-${STAMP}.csv`;
      const two = `orders-two-${STAMP}.csv`;
      await page.goto("/ingest");
      await upload(page, one, Buffer.from([oh.join(","), row("41", "01/10/2025")].join("\n")));
      await readDone(page, one);
      const hrefOne = await reviewHref(page, one);
      await page.goto(hrefOne);
      await page.getByRole("button", { name: "Map columns for me" }).click();
      await expect(bar(page)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
      await page.getByLabel(/^Financial year/).selectOption("2025-26");
      await page.getByLabel(/^As on date/).fill("31/03/2026");
      await page.getByRole("button", { name: "Save year" }).click();
      await expect(page.getByTestId("year-line").getByText(/^Financial year 2025-26/)).toBeVisible({ timeout: 30_000 });
      await bar(page).getByRole("button", { name: "Approve", exact: true }).click({ timeout: 60_000 });
      await expect(bar(page)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
      await page.goto("/ingest");
      await upload(page, two, Buffer.from([oh.join(","), row("42", "02/10/2025")].join("\n")));
      await readDone(page, two);
      urls.conflict = await reviewHref(page, two);
      await page.goto(urls.conflict);
      await expect(bar(page)).toBeVisible({ timeout: 60_000 });
      if (await page.getByLabel(/^Financial year/).count()) {
        await page.getByLabel(/^Financial year/).selectOption("2025-26");
        await page.getByLabel(/^As on date/).fill("31/03/2026");
        await page.getByRole("button", { name: "Save year" }).click();
      }
      await expect(page.getByText(/is on old order|और एक|पर है/).first()).toBeVisible({ timeout: 120_000 });
      await shootUrl(page, "review-conflict-two-files", urls.conflict, () => expect(bar(page)).toBeVisible({ timeout: 60_000 }));
    } finally {
      await fakeBot(page, { action: "clear" });
    }
  });
});
