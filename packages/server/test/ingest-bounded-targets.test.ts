/**
 * Rule 4.4 (PORTAL-RULES-3): every dry run step and every merge step reads a number of rows bounded
 * by a constant times the rows it handles, and sends at most 400 statements a batch. For a
 * 5,000-row sheet of each target, the first and the last step of the dry run and of the writes are
 * counted with D1's own `meta.rows_read`.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { IngestTarget } from "@orrn/db/schema/ingest";
import type { Recipe } from "@orrn/ingest";

import { createTestEnv, type TestEnv } from "./harness";
import { counting, newTally, resetTally, seedBulk, type Tally } from "./ingest-count-helpers";
import { apiFor, contextFor } from "./ingest-merge-fixture";
import { DIE_HEADERS, dieLayout, layout, learnLayout, trim } from "./ingest-portal-helpers";
import { CHUNK_ROWS } from "../src/lib/ingest/merge/shared";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

const ROWS = 5_000;
/** D1 takes 1,000 statements a Worker request; a step also reads. */
const BATCH_MAX = 400;
/** A dry run page is 200 rows. A step other than the last reads at most this many rows. */
const DRY_STEP_MAX = 4_000;
/**
 * The last dry run step checks the whole sheet: at most this many reads a row of the sheet, plus
 * DRY_STEP_MAX. An order book's last step counts its rows once (3 reads a row), reads them for the
 * whole-order pass and for the period (3), and looks for the same orders in another sheet by both
 * keys (about 5 a row). When every order is also in another sheet, the rows of both sheets turn
 * into conflicts, each by primary key with its count: about 20 a row in all, measured. Before, the
 * PO-only book read 465,020 rows here and the book uploaded twice 521,484 (S4-2), growing with the
 * square of the rows; now 35,020 and 100,148.
 */
const DRY_LAST_PER_ROW = 24;
/** A write step reads at most this, plus WRITE_PER_ROW a row of its chunk. */
const WRITE_BASE = 1_000;
const WRITE_PER_ROW = 10;

async function api(companyId: string, tally: Tally) {
  const ctx = await contextFor(env, companyId, "owner");
  const { createDb } = await import("@orrn/db");
  return apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
}

/** Upload one sheet through the real procedures; its layout is learned first, so no model runs. */
async function uploadSheet(companyId: string, ownerId: string, recipe: Recipe, headers: string[], rows: string[][]) {
  await learnLayout(env, companyId, ownerId, recipe, `L-${randomUUID().slice(0, 6)}`);
  const as = env.caller({ role: "owner", companyId });
  const begin = await as.ingest.artifact.begin({ sha256: createHash("sha256").update(randomUUID()).digest("hex"), fileName: "big.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
  const put = await as.ingest.artifact.putBlocks({
    artifactId: begin.artifactId,
    blocks: [{ ordinal: 0, sheetName: "S", title: null, headerRow: 0, headerRows: 1, headers, rowCount: rows.length, sample: rows.slice(0, 200) }],
  });
  const blockId = put.blocks[0]!.blockId;
  for (let i = 0; i < rows.length; i += 500) await as.ingest.artifact.putRows({ blockId, fromIndex: i, expectRowsPut: i, rows: rows.slice(i, i + 500) });
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  return put.candidates[0]!.id;
}

/** Every dry run step of a candidate: rows read and the largest batch of each. */
async function dryRun(companyId: string, candidateId: string) {
  const tally = newTally();
  const a = await api(companyId, tally);
  let cursor = (await a.ingest.candidate.get({ candidateId })).dryCursor;
  const steps: { rows: number; maxBatch: number }[] = [];
  for (let i = 0; i < 200; i += 1) {
    resetTally(tally);
    const out = await a.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    steps.push({ rows: tally.rows, maxBatch: tally.maxBatch });
    if (out.done) break;
    cursor = out.cursor;
  }
  return steps;
}

function expectDryBounded(label: string, steps: { rows: number; maxBatch: number }[], rows: number) {
  if (process.env.DEBUG_READS) console.log("DRY", label, "steps", steps.length, "first", steps[0], "last", steps.at(-1), "max before last", Math.max(...steps.slice(0, -1).map((s) => s.rows)));
  expect(steps.length).toBeGreaterThan(1);
  for (const s of steps.slice(0, -1)) expect(s.rows).toBeLessThanOrEqual(DRY_STEP_MAX);
  expect(steps.at(-1)!.rows).toBeLessThanOrEqual(DRY_STEP_MAX + DRY_LAST_PER_ROW * rows);
  for (const s of steps) expect(s.maxBatch).toBeLessThanOrEqual(BATCH_MAX);
}

/** Every write step of a merge of the plant's ready candidates: rows read while a chunk is written. */
async function mergeWrites(companyId: string) {
  const tally = newTally();
  const a = await api(companyId, tally);
  const { runId } = await a.ingest.merge.start();
  let last = await a.ingest.merge.step({ runId, expectCursor: 0 });
  while (last.state === "planning") last = await a.ingest.merge.step({ runId, expectCursor: last.cursor });
  const writes: number[] = [];
  let maxBatch = 0;
  while (last.state === "running") {
    resetTally(tally);
    const before = last.chunksWritten + last.chunksFailed;
    last = await a.ingest.merge.step({ runId, expectCursor: last.cursor });
    maxBatch = Math.max(maxBatch, tally.maxBatch);
    if (last.chunksWritten + last.chunksFailed > before) writes.push(tally.rows);
  }
  return { state: last.state, failed: last.chunksFailed, writes, maxBatch };
}

function expectWritesBounded(label: string, target: IngestTarget, m: Awaited<ReturnType<typeof mergeWrites>>) {
  if (process.env.DEBUG_READS) console.log("WRITE", label, "steps", m.writes.length, "first", m.writes.slice(0, 2), "last", m.writes.slice(-2), "max", Math.max(...m.writes), "batch", m.maxBatch);
  expect(m.state).toBe("done");
  expect(m.writes.length).toBeGreaterThan(1);
  for (const n of m.writes) expect(n).toBeLessThanOrEqual(WRITE_BASE + WRITE_PER_ROW * CHUNK_ROWS[target].create);
  // The last step reads about what the first does: nothing grows with the rows written before.
  expect(m.writes.at(-1)!).toBeLessThanOrEqual(1.25 * m.writes[0]! + 200);
  expect(m.maxBatch).toBeLessThanOrEqual(BATCH_MAX);
}

const n = (i: number) => String(i + 1);
const SEED_VALUES: Record<Exclude<IngestTarget, "orders">, (i: number, x: Record<string, string>) => Record<string, unknown>> = {
  customers: (i) => ({ name: `Bulk Party ${i}` }),
  vendors: (i) => ({ name: `Bulk Vendor ${i}` }),
  dies: (i) => ({ series: "R", sectionCode: String(10000 + i), weightMinG: 2000, weightMaxG: 2400 }),
  bundles: (i, x) => ({ legacyId: `L-${i}`, series: "R", sectionCode: "8100", quantity: 10, weightG: 50_000, lengthMm: 3658, _ids: { sectionCode: x.dieId } }),
  customer_aliases: (i, x) => ({ customer: "Party", alias: `Alias ${i}`, _ids: { customer: x.customerId } }),
  vendor_aliases: (i, x) => ({ vendor: "Mahadev Scrap", alias: `Other name ${i}`, _ids: { vendor: x.vendorId } }),
  die_copies: (_i, x) => ({ series: "R", sectionCode: "8100", _ids: { sectionCode: x.dieId } }),
};

async function plantFor(target: IngestTarget) {
  const { companyId, users } = await env.seedCompany({ settings: { dieRequiredOnSalesOrder: false } });
  const x: Record<string, string> = {};
  x.dieId = await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
  if (target === "customer_aliases" || target === "orders") x.customerId = await env.seedCustomer(companyId);
  if (target === "vendor_aliases") x.vendorId = (await env.caller({ role: "owner", companyId }).vendor.create({ name: "Mahadev Scrap" })).id;
  return { companyId, ownerId: users.owner.id, x };
}

describe("rule 4.4: every write step of a 5,000-row sheet is bounded, the last as the first", () => {
  for (const target of Object.keys(SEED_VALUES) as Exclude<IngestTarget, "orders">[]) {
    test(`${target}: each write step reads at most ${WRITE_BASE} plus ${WRITE_PER_ROW} a chunk row`, async () => {
      const p = await plantFor(target);
      await seedBulk(env, p.companyId, target, ROWS, (i) => SEED_VALUES[target](i, p.x));
      expectWritesBounded(target, target, await mergeWrites(p.companyId));
    }, 600_000);
  }

  test("orders: each write step of 2,500 two-line orders reads a bounded page", async () => {
    const p = await plantFor("orders");
    await seedBulk(env, p.companyId, "orders", ROWS, (i) => ({
      customer: "Party",
      oldOrderNo: `O-${Math.floor(i / 2)}`,
      poNumber: i % 2 ? "" : `P-${Math.floor(i / 2)}`,
      orderDate: "2025-10-31",
      series: "R",
      sectionCode: "8100",
      cutLength: 3000 + (i % 2),
      bakiKg: 250_000,
      _ids: { customer: p.x.customerId, sectionCode: p.x.dieId },
    }));
    const m = await mergeWrites(p.companyId);
    // Orders go 10 to a chunk, not by rows: the bound is on 20 lines.
    if (process.env.DEBUG_READS) console.log("WRITE orders", m.writes.slice(0, 2), m.writes.slice(-2), Math.max(...m.writes));
    expect(m.state).toBe("done");
    for (const w of m.writes) expect(w).toBeLessThanOrEqual(WRITE_BASE);
    expect(m.writes.at(-1)!).toBeLessThanOrEqual(1.25 * m.writes[0]! + 200);
  }, 600_000);
});

const BOOK = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
const bookLayout = () =>
  layout(
    "orders",
    BOOK,
    [
      { field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
      { field: "oldOrderNo", steps: trim },
      { field: "poNumber", steps: trim },
      { field: "orderDate", steps: [{ op: "date", format: "dmy" }] },
      { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
      { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
      { field: "cutLength", steps: [{ op: "number", kind: "length", unit: "mm" }] },
      { field: "bakiKg", steps: [{ op: "number", kind: "mass", unit: "kg" }] },
    ],
    ["customer", "oldOrderNo", "orderDate"],
  );

/** One sheet of each target, as a person's file would hold it. */
const SHEETS: Record<IngestTarget, { recipe: () => Recipe; headers: string[]; row: (i: number) => string[] }> = {
  customers: {
    recipe: () => layout("customers", ["Party name", "City"], [{ field: "name", steps: trim }, { field: "city", steps: trim }], ["name"]),
    headers: ["Party name", "City"],
    row: (i) => [`Bulk Party ${i}`, "Rajkot"],
  },
  vendors: { recipe: () => layout("vendors", ["Vendor"], [{ field: "name", steps: trim }], ["name"]), headers: ["Vendor"], row: (i) => [`Bulk Vendor ${i}`] },
  dies: { recipe: dieLayout, headers: DIE_HEADERS, row: (i) => ["R", String(10000 + i), "2.0", "2.4"] },
  bundles: {
    recipe: () =>
      layout(
        "bundles",
        ["Bundle id", "Series", "Section", "Pcs", "Wt (kg)", "Len (mm)"],
        [
          { field: "legacyId", steps: trim },
          { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
          { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
          { field: "quantity", steps: [{ op: "number", kind: "count", unit: "pcs" }] },
          { field: "weightG", steps: [{ op: "number", kind: "mass", unit: "kg" }] },
          { field: "lengthMm", steps: [{ op: "number", kind: "length", unit: "mm" }] },
        ],
        ["legacyId"],
      ),
    headers: ["Bundle id", "Series", "Section", "Pcs", "Wt (kg)", "Len (mm)"],
    row: (i) => [`B-${i}`, "R", "8100", "10", "50", "3658"],
  },
  customer_aliases: {
    recipe: () =>
      layout("customer_aliases", ["Party", "Also called"], [{ field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] }, { field: "alias", steps: trim }], ["alias"]),
    headers: ["Party", "Also called"],
    row: (i) => ["Acme Traders", `Acme ${i}`],
  },
  vendor_aliases: {
    recipe: () => layout("vendor_aliases", ["Vendor", "Also called"], [{ field: "vendor", steps: [{ op: "trim" }, { op: "lookup", resolver: "vendor_by_name" }] }, { field: "alias", steps: trim }], ["alias"]),
    headers: ["Vendor", "Also called"],
    row: (i) => ["Mahadev Scrap", `Mahadev ${i}`],
  },
  die_copies: {
    recipe: () =>
      layout(
        "die_copies",
        ["Series", "Section", "Maker die no"],
        [
          { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
          { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
          { field: "makerDieNo", steps: [{ op: "trim" }, { op: "lookup", resolver: "die_copy_by_code" }] },
        ],
        ["series", "sectionCode", "makerDieNo"],
      ),
    headers: ["Series", "Section", "Maker die no"],
    row: (i) => ["R", "8100", `M-${i}`],
  },
  orders: { recipe: bookLayout, headers: BOOK, row: (i) => ["Acme Traders", n(Math.floor(i / 2)), i % 2 ? "" : `PO-${n(Math.floor(i / 2))}`, "31/10/2025", "R", "8100", "3658", "100"] },
};

describe("rule 4.4: every dry run step of a 5,000-row sheet is bounded, the last too", () => {
  async function plant() {
    const { companyId, users } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.customer.create({ name: "Acme Traders" });
    await owner.vendor.create({ name: "Mahadev Scrap" });
    await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
    return { companyId, ownerId: users.owner.id };
  }

  for (const target of Object.keys(SHEETS) as IngestTarget[]) {
    test(`${target}: each step at most ${DRY_STEP_MAX} rows, the last at most ${DRY_LAST_PER_ROW} a row of the sheet more`, async () => {
      const p = await plant();
      const s = SHEETS[target];
      const id = await uploadSheet(p.companyId, p.ownerId, s.recipe(), s.headers, Array.from({ length: ROWS }, (_, i) => s.row(i)));
      expectDryBounded(target, await dryRun(p.companyId, id), ROWS);
    }, 600_000);
  }

  test("customer_aliases: a page reads only the names on it, never every customer of the plant", async () => {
    const p = await plant();
    const { customer } = await import("@orrn/db/schema/customers");
    const many = Array.from({ length: 3000 }, (_, i) => ({ id: `cx-${p.companyId}-${i}`, companyId: p.companyId, name: `Party ${i}`, nameKey: `party ${i}` }));
    const inserts = [];
    for (let i = 0; i < many.length; i += 20) inserts.push(env.db.insert(customer).values(many.slice(i, i + 20)));
    for (let i = 0; i < inserts.length; i += 100) await env.db.batch(inserts.slice(i, i + 100) as unknown as Parameters<typeof env.db.batch>[0]);
    const s = SHEETS.customer_aliases;
    const id = await uploadSheet(p.companyId, p.ownerId, s.recipe(), s.headers, Array.from({ length: 200 }, (_, i) => s.row(i)));
    // Count the reads of the whole customer table on each step. The name resolver keeps its one
    // in-memory index a step (plan B4); the alias owner check used to read the table again.
    const tally: Tally = { ...newTally(), log: [] };
    const a = await api(p.companyId, tally);
    let cursor = 0;
    const whole: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      resetTally(tally);
      const out = await a.ingest.dryRun.step({ candidateId: id, expectCursor: cursor });
      whole.push(tally.log!.filter((l) => /from "customer"/.test(l.q) && l.rows >= 3000).length);
      if (out.done) break;
      cursor = out.cursor;
    }
    expect(whole.length).toBeGreaterThan(1);
    for (const n of whole) expect(n).toBeLessThanOrEqual(1);
  }, 600_000);

  test("orders: 2,500 orders of a numbered row and a PO-only row (S4-2 a)", async () => {
    const p = await plant();
    const rows = Array.from({ length: ROWS }, (_, i) => ["Acme Traders", i % 2 ? "" : n(i / 2), `PO-${n(Math.floor(i / 2))}`, "31/10/2025", "R", "8100", String(3658 + (i % 2)), "100"]);
    const id = await uploadSheet(p.companyId, p.ownerId, bookLayout(), BOOK, rows);
    const steps = await dryRun(p.companyId, id);
    expectDryBounded("orders PO-only", steps, ROWS);
    const c = await env.caller({ role: "owner", companyId: p.companyId }).ingest.candidate.get({ candidateId: id });
    expect([c.state, c.counts.create, c.openQuestions]).toEqual(["ready", ROWS, 0]);
  }, 600_000);

  test("orders: the same 5,000-row book uploaded twice (S4-2 b)", async () => {
    const p = await plant();
    const rows = Array.from({ length: ROWS }, (_, i) => SHEETS.orders.row(i));
    const first = await uploadSheet(p.companyId, p.ownerId, bookLayout(), BOOK, rows);
    expectDryBounded("orders first", await dryRun(p.companyId, first), ROWS);
    const second = await uploadSheet(p.companyId, p.ownerId, bookLayout(), BOOK, rows);
    expectDryBounded("orders twice", await dryRun(p.companyId, second), ROWS);
    // Every order is in both: both sides show the other file.
    const as = env.caller({ role: "owner", companyId: p.companyId });
    expect((await as.ingest.candidate.get({ candidateId: second })).counts.conflict).toBe(ROWS);
    expect((await as.ingest.candidate.get({ candidateId: first })).counts.conflict).toBe(ROWS);
  }, 900_000);
});
