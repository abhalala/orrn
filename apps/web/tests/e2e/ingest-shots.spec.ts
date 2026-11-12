import { headerKey, normalizeHeaders } from "@orrn/ingest";
import { expect, test, type Page } from "@playwright/test";

import { signInViaApi } from "./helpers/accounts";
import { makeParty, q } from "./helpers/orders-api";
import { API_URL } from "./helpers/ports";

/** Screenshots of the Imports screens for the design review (not a test of behaviour). Run by hand: SHOTS=1. */
test.skip(!process.env.SHOTS, "set SHOTS=1");
test.describe.configure({ mode: "serial", timeout: 600_000 });

const OUT = "/Users/abhalala/Documents/business/fc/.unslop-build/platform/portal-shots-3";
const STAMP = Date.now().toString(36).toUpperCase().slice(-5);
const DIE_HEADER = "Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft),Name,Width (mm),Thickness (mm),Leg (mm),Status,Notes";
const dieRows = (series: string, codes: string[]) => codes.map((c, i) => `${series},${c},${(1.1 + i / 10).toFixed(1)},${(1.4 + i / 10).toFixed(1)},Ingest test ${c},30,1.5,,active,`);
const dieCsv = (series: string, codes: string[], header = DIE_HEADER) => Buffer.from([header, ...dieRows(series, codes)].join("\n"));

const WIDTHS = [1280, 820, 375] as const;
const LOCALES = ["en", "hi"] as const;

async function prepare(page: Page, locale: "en" | "hi", dark = false) {
  await page.addInitScript((l) => localStorage.setItem("orrn.locale", l), locale);
  await page.emulateMedia({ colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" });
}
async function snap(page: Page, name: string, width: number, locale: string, dark = false) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}-${width}-${locale}${dark ? "-dark" : ""}.png`, fullPage: true });
}
/** A page by URL at every width and language, light, plus dark at 1280 in English when asked. */
async function shootUrl(page: Page, name: string, url: string, opts: { dark?: boolean; ready?: () => Promise<void> } = {}) {
  for (const locale of LOCALES) {
    await prepare(page, locale);
    await page.goto(url);
    await opts.ready?.();
    for (const w of WIDTHS) await snap(page, name, w, locale);
  }
  if (opts.dark) {
    await prepare(page, "en", true);
    await page.goto(url);
    await opts.ready?.();
    await snap(page, name, 1280, "en", true);
    await prepare(page, "en", false);
  }
}
async function upload(page: Page, name: string, buffer: Buffer, mimeType = "text/csv") {
  await page.locator("input[type='file']").setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: /^Add \d+ files?$|^\d+ फ़ाइल/ }).click();
}
const step = (page: Page) => page.getByTestId("header-step");
const bar = (page: Page) => page.getByTestId("decision-bar");

async function fakeBot(page: Page, body: unknown) {
  const res = await page.context().request.post(`${API_URL}/dev/ingest-bot`, { data: body });
  expect(res.ok()).toBe(true);
}

/** The header step for a file, shot at every width in one language, then once dark. */
async function shootStep(page: Page, label: string, file: string, csv: Buffer, ready: () => Promise<void>, dark = false) {
  for (const locale of LOCALES) {
    await prepare(page, locale);
    await page.goto("/ingest");
    await upload(page, `${label}-${locale}-${file}`, csv);
    await expect(step(page)).toBeVisible({ timeout: 60_000 });
    await ready();
    for (const w of WIDTHS) await snap(page, label, w, locale);
  }
  if (dark) {
    await prepare(page, "en", true);
    await page.goto("/ingest");
    await upload(page, `${label}-dark-${file}`, csv);
    await expect(step(page)).toBeVisible({ timeout: 60_000 });
    await ready();
    await snap(page, label, 1280, "en", true);
    await prepare(page, "en", false);
  }
}

test("shots", async ({ page, request }) => {
  await request.post(`${API_URL}/dev/seed`);
  await signInViaApi(page, "admin");

  const skipHeader = !!process.env.SKIP_HEADER;
  // Upload screen, nothing yet.
  if (!skipHeader) await shootUrl(page, "upload-empty", "/ingest", { ready: async () => void (await page.locator("main#main h1").first().waitFor()) });

  // Header step states (in memory: the file is added again for each language).
  if (!skipHeader) {
    const lh = [`Lh series ${STAMP}`, `Lh profile ${STAMP}`, `Lh low ${STAMP} kg/12ft`, `Lh high ${STAMP} kg/12ft`];
    const letterhead = Buffer.from(["FourCubes Extrusions,,,", "Old sections, October,,", lh.join(","), "Z1,LH1,1.1,1.4", "Z1,LH2,1.2,1.5"].join("\n"));
    await shootStep(page, "header-asking", "a.csv", letterhead, async () => {}, true);
    await shootStep(page, "header-two-rows", "b.csv", letterhead, async () => {
      await step(page).getByRole("radio", { name: /^(Row|लाइन) 3:/ }).check();
      await step(page).getByRole("radio", { name: /Two rows|दो लाइनें/ }).check();
    });
    const renamed = DIE_HEADER.replace("Notes", `Remarks ${STAMP}`);
    await shootStep(page, "header-resembles", "c.csv", dieCsv(`H${STAMP.slice(0, 3)}`, [`${STAMP}H1`], renamed), async () => {});
    const uh = [`Jn series ${STAMP}`, `Jn profile ${STAMP}`, `Jn low ${STAMP} kg/12ft`, `Jn high ${STAMP} kg/12ft`];
    const joinCsv = Buffer.from([uh.join(","), "Z1,JN1,1.1,1.4", "Z1,JN2,1.2,1.5", ",,,", "Z1,Total,,", "Z1,JN3,1.3,1.6"].join("\n"));
    const sameCsv = Buffer.from([uh.join(","), "Z1,JN1,1.1,1.4", "Z1,JN2,1.2,1.5", ",,,", uh.join(","), "Z1,JN3,1.3,1.6"].join("\n"));
    await shootStep(page, "header-join-offers", "d.csv", joinCsv, async () => {
      await step(page).getByRole("button", { name: /Use row 1|लाइन 1 लें/ }).click();
      await expect(step(page).getByText(/It continues the table above|यह ऊपर की टेबल का ही हिस्सा है/)).toBeVisible({ timeout: 60_000 });
    }, true);
    await shootStep(page, "header-same-columns", "e.csv", sameCsv, async () => {
      await step(page).getByRole("button", { name: /Use row 1|लाइन 1 लें/ }).click();
      await expect(step(page).getByText(/Same columns as the table above|ऊपर की टेबल जैसे ही कॉलम/)).toBeVisible({ timeout: 60_000 });
    });
    const twoTables = Buffer.from([uh.join(","), "Z1,TW1,1.1,1.4", ",,,", "Party,Order,Kg,Date", "Shree,41,10,2026-10-01", "Om,42,20,2026-10-02"].join("\n"));
    await shootStep(page, "header-several-tables", "f.csv", twoTables, async () => {
      await expect(step(page).getByText(/Table 1 of 2|2 में से टेबल 1/)).toBeVisible();
    });

  }

  // Imports on the list: a known sheet left Ready, one approved, one merged, a held one.
  await prepare(page, "en");
  await page.goto("/ingest");
  const ids: Record<string, string> = {};
  const done = async (name: string) => {
    await expect(page.locator("li[data-step]", { hasText: name }).getByText(/^Read\. \d+ tables?/)).toBeVisible({ timeout: 60_000 });
  };
  const reviewLink = async (name: string) => {
    // An import being checked is in no segment yet: look again until it settles.
    for (let tries = 0; tries < 40; tries += 1) {
      await page.goto("/ingest");
      for (const seg of ["Needs you", "Ready", "Approved", "Merged"]) {
        await page.getByRole("radio", { name: new RegExp(`^${seg} `) }).click();
        const link = page.locator("tbody tr", { hasText: name }).getByRole("link").first();
        if (await link.count()) return (await link.getAttribute("href"))!;
      }
      await page.waitForTimeout(2000);
    }
    throw new Error(`no row for ${name}`);
  };
  const series = `S${STAMP.slice(0, 3)}`;
  for (const [key, code] of [["merged", `${STAMP}M`], ["approved", `${STAMP}A`], ["ready", `${STAMP}R`], ["held", `${STAMP}H`]] as const) {
    const file = `dies-${key}-${STAMP}.csv`;
    await upload(page, file, dieCsv(series, [code]));
    await done(file);
  }
  const approveRow = async (key: string) => {
    const file = `dies-${key}-${STAMP}.csv`;
    const href = await reviewLink(file);
    await page.goto(href);
    await expect(bar(page)).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    ids[key] = href;
    return file;
  };
  await approveRow("merged");
  await bar(page).getByRole("button", { name: "Approve", exact: true }).click();
  await expect(bar(page)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  await page.goto("/ingest");
  const mergeBtn = page.getByRole("button", { name: /^Merge \d+ approved imports?$/ });
  await mergeBtn.click();
  await shootMergeConfirm(page);
  await page.getByRole("dialog").getByRole("button", { name: /^Merge \d+ approved imports?$/ }).click();
  await expect(page).toHaveURL(/\/ingest\/merge\//, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Merge finished", level: 1 })).toBeVisible({ timeout: 120_000 });
  ids.mergeRun = new URL(page.url()).pathname;
  await approveRow("approved");
  await bar(page).getByRole("button", { name: "Approve", exact: true }).click();
  await expect(bar(page)).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  await approveRow("held");
  await bar(page).getByRole("button", { name: "Hold", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Hold", exact: true }).click();
  await expect(bar(page)).toHaveAttribute("data-state", "held", { timeout: 30_000 });
  await approveRow("ready");

  // Other review states.
  const near = `near-${STAMP}.csv`;
  await page.goto("/ingest");
  await upload(page, near, dieCsv(`N${STAMP.slice(0, 3)}`, [`${STAMP}N`], renamed));
  await expect(step(page)).toBeVisible({ timeout: 60_000 });
  await step(page).getByRole("button", { name: /Use row 1|लाइन 1 लें/ }).click();
  await done(near);
  ids.nearfit = await reviewLink(near);

  const bundles = `bundles-${STAMP}.csv`;
  await page.goto("/ingest");
  await upload(page, bundles, Buffer.from(["Legacy id,Series,Section code,Quantity,Weight (kg),Length (mm),PO number", `ZB${STAMP}1,${series},${STAMP}M,10,400,3658,`, `ZB${STAMP}2,${series},${STAMP}M,10,58.4,3658,`].join("\n")));
  await done(bundles);
  ids.magnitude = await reviewLink(bundles);

  const unknown = `unknown-${STAMP}.csv`;
  const uh2 = [`Sec series ${STAMP}`, `Profile no ${STAMP}`, `Low ${STAMP} kg/12ft`, `High ${STAMP} kg/12ft`];
  await page.goto("/ingest");
  await upload(page, unknown, Buffer.from([uh2.join(","), `${series},${STAMP}U,1.2,1.5`].join("\n")));
  await expect(step(page)).toBeVisible({ timeout: 60_000 });
  await step(page).getByRole("button", { name: /Use row 1|लाइन 1 लें/ }).click();
  await done(unknown);
  ids.needsShape = await reviewLink(unknown);

  // One PO on two orders.
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
  const orders = `po-twice-${STAMP}.csv`;
  await page.goto("/ingest");
  await upload(page, orders, Buffer.from([oh.join(","), `${party.name},41,PO-${STAMP},01/10/2025,${die.series},${die.sectionCode},100,3658`, `${party.name},42,PO-${STAMP},02/10/2025,${die.series},${die.sectionCode},200,3658`].join("\n")));
  await expect(step(page)).toBeVisible({ timeout: 60_000 });
  await step(page).getByRole("button", { name: /Use row 1|लाइन 1 लें/ }).click();
  await done(orders);
  const ordersHref = await reviewLink(orders);
  await page.goto(ordersHref);
  await page.getByRole("button", { name: "Map columns for me" }).click();
  await expect(bar(page)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
  await page.getByLabel(/^Financial year/).selectOption("2025-26");
  await page.getByLabel(/^As on date/).fill("31/03/2026");
  await page.getByRole("button", { name: "Save year" }).click();
  await expect(page.locator("tbody tr").filter({ hasText: /is on old order/ }).first()).toBeVisible({ timeout: 90_000 });
  ids.poConflict = ordersHref;
  await fakeBot(page, { action: "clear" });

  // The list at every state, then each review.
  await shootUrl(page, "candidates-list", "/ingest", { dark: true, ready: async () => void (await page.getByRole("radio", { name: /^Needs you / }).waitFor()) });
  for (const [name, href] of Object.entries(ids)) {
    if (name === "mergeRun") continue;
    await shootUrl(page, `review-${name}`, href, {
      dark: ["ready", "magnitude", "poConflict"].includes(name),
      ready: async () => void (await expect(bar(page)).toBeVisible({ timeout: 30_000 })),
    });
  }
  await shootUrl(page, "merge-done", ids.mergeRun!, { ready: async () => void (await page.getByRole("heading", { level: 1 }).first().waitFor()) });

  // The mapping editor, open.
  await prepare(page, "en");
  await page.goto(ids.needsShape!);
  await page.getByRole("button", { name: "Map columns myself" }).click();
  for (const w of WIDTHS) await snap(page, "review-mapping-editor", w, "en");

  // Kept files: the plant has no storage here, so the list answer carries one kept file and the screen draws it.
  await page.route("**/trpc/ingest.artifact.list*", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const first = Array.isArray(body) ? body[0] : body;
    const items = first?.result?.data?.json?.items ?? first?.result?.data?.items;
    const mk = (id: string, fileName: string, sizeBytes: number, createdAt: number) => ({
      id, sha256: id.repeat(8), fileName, contentType: null, kind: "pdf_text", sizeBytes, vaultState: "stored", readState: "kept_unread", readError: null,
      blockCount: 0, rowCount: 0, period: null, periodConfirmed: null, note: null, uploadedBy: null, createdAt,
    });
    if (Array.isArray(items)) {
      items.push(mk("kp1", "Packing list Oct-25.pdf", 482_113, Date.now() - 86_400_000), mk("kp2", "Stock register page 4.jpg", 2_400_000, Date.now() - 3 * 86_400_000));
    }
    await route.fulfill({ response: res, json: body });
  });
  await shootUrl(page, "kept-files", "/ingest", { dark: true, ready: async () => void (await page.getByTestId("kept-files").waitFor({ timeout: 30_000 })) });
});

async function shootMergeConfirm(page: Page) {
  for (const w of WIDTHS) await snap(page, "merge-confirm", w, "en");
}
