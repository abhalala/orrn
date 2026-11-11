/**
 * Infinity Portal merge, lane B (B-new-2): every write step reads a bounded, indexed page. The
 * rows a step reads are counted from D1's own `meta.rows_read` (Miniflare reports it like
 * production). A 5,000-row order book whose 1,000 orders interleave over the whole sheet is the
 * worst case for the old range scan: every chunk's row range spans almost the whole candidate.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { IngestTarget } from "@orrn/db/schema/ingest";

import { createTestEnv, type TestEnv } from "./harness";
import { apiFor, candidateRow, contextFor, seedCandidate, stagedRows } from "./ingest-merge-fixture";
import { ORDERS_TOO_BIG } from "../src/lib/ingest/merge/planner";
import { orderKeyOf } from "../src/lib/ingest/merge/shared";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

/**
 * The most rows one write step may read, all tables and all statements together, for a chunk of 10
 * orders of 5 lines (50 staged rows) taken from a 5,000-row candidate. The step reads its own
 * staged rows by the chunk mark (50), finds its chunk among the run's chunks, and makes and confirms
 * 10 orders through createSalesOrder and confirmOrder: about 400 rows here. Before this fix one
 * step read the order key of every queued row in its range and recounted the whole candidate:
 * 24,210 rows for the first step.
 */
export const STEP_ROWS_READ_MAX = 1_000;

/**
 * How many more rows the last write step of a run may read than its first. A step reads its own
 * chunk, never the chunks written before it: before this fix the last step of a 500-chunk run read
 * about 250 rows more than the first (half a row per earlier chunk), which passes 1,000 rows near
 * 5,000 chunks (a 50,000-line book).
 */
export const STEP_GROWTH_MAX = 20;

/** Rows recorded per statement when each row was written to its own record (Bm7). */
const RECORD_ROWS_PER_STATEMENT = 30;
/** A step that makes 500 customers in one call: 99 statements now, 582 before (500 to record). */
export const CUSTOMER_STEP_STATEMENTS_MAX = 150;
/** A step that makes 10 orders of 100 lines: 438 now, 1,418 before (over D1's 1,000 a request). */
export const ORDER_STEP_STATEMENTS_MAX = 600;

/**
 * The most statements one planning batch may send. D1 allows 1,000 statements a Worker request;
 * the step also reads. Planning 5,000 one-line orders sent 1,002 in one batch (M-new-1).
 */
export const PLAN_BATCH_STATEMENTS_MAX = 400;
/**
 * The most rows one planning step may read, all statements together (Bm5). An orders candidate is
 * planned in one step, so its sheet is read whole: at most ORDERS_PLAN_MAX_ROWS (5,000) rows, and a
 * larger one is held, read only that far. Other targets read at most 4,000 rows a step, from where
 * the last step stopped. Before, the step after the orders page read the 5,000 queued rows again.
 */
export const PLAN_ROWS_READ_MAX = 16_000;

/**
 * The most rows one planning step of a target other than orders may read: a window of 4,000 rows
 * from where the last step stopped, and the marks of at most 2,000 planned rows (two reads a row).
 * Before, each page read every ready row of the candidate again, queued ones too: up to 14,027
 * rows a step for this sheet.
 */
export const PLAN_PAGE_ROWS_READ_MAX = 9_000;

const ROWS = 5_000;
const ORDERS = 1_000;

/** Rows D1 read, and statements sent (D1 allows 1,000 per Worker invocation on the paid plan). */
type Tally = { rows: number; statements: number; maxBatch?: number };

/**
 * A D1 binding that adds up `meta.rows_read` of every statement and counts the statements. `raw()` and `first()` return no
 * meta, so a select read that way is also run once with `all()` to learn its rows read (a select
 * has no side effects). Statements keep their real object for `batch()`.
 */
function counting(d1: D1Database, tally: Tally): D1Database {
  const real = new WeakMap<object, D1PreparedStatement>();
  const queries = new WeakMap<object, string>();
  const add = (meta: { rows_read?: number } | undefined, q = "") => {
    tally.rows += Number(meta?.rows_read ?? 0);
    if (process.env.DEBUG_READS && Number(meta?.rows_read ?? 0) > 100) console.log("READS", meta?.rows_read, q.slice(0, 300));
  };
  const wrap = (stmt: D1PreparedStatement, query: string): D1PreparedStatement => {
    const isSelect = /^\s*(select|with)\b/i.test(query);
    const proxy = new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") return (...args: unknown[]) => wrap(target.bind(...args), query);
        if (prop === "all" || prop === "run") {
          return async () => {
            tally.statements += 1;
            const res = await (target[prop] as () => Promise<D1Result>).call(target);
            add(res.meta, query);
            return res;
          };
        }
        if (prop === "raw" || prop === "first") {
          return async (...args: unknown[]) => {
            tally.statements += 1;
            if (isSelect) add((await target.all()).meta, query);
            return (target[prop] as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    real.set(proxy, stmt);
    queries.set(proxy, query);
    return proxy;
  };
  return new Proxy(d1, {
    get(target, prop) {
      if (prop === "prepare") return (query: string) => wrap(target.prepare(query), query);
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          tally.statements += statements.length;
          tally.maxBatch = Math.max(tally.maxBatch ?? 0, statements.length);
          const res = await target.batch(statements.map((s) => real.get(s) ?? s));
          res.forEach((r, i) => add(r.meta, queries.get(statements[i]!) ?? ""));
          return res;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Staged rows straight into D1, 8 rows per insert (under 100 bound parameters). */
async function seedBulk(companyId: string, target: IngestTarget, total: number, valuesAt: (i: number) => Record<string, unknown>): Promise<string> {
  const seeded = await seedCandidate(env, companyId, target, []);
  const { ingestStagedRow } = await import("@orrn/db/schema/ingest");
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `b${seeded.candidateId}-${i}`,
    companyId,
    rowKey: `k${seeded.candidateId}-${i}`,
    candidateId: seeded.candidateId,
    rowIndex: i,
    raw: [],
    values: valuesAt(i),
    orderKey: target === "orders" ? orderKeyOf(valuesAt(i), `k${seeded.candidateId}-${i}`) : null,
    state: "ready_create" as const,
  }));
  const inserts = [];
  for (let i = 0; i < rows.length; i += 8) inserts.push(env.db.insert(ingestStagedRow).values(rows.slice(i, i + 8)));
  for (let i = 0; i < inserts.length; i += 100) {
    const part = inserts.slice(i, i + 100);
    await env.db.batch(part as unknown as Parameters<typeof env.db.batch>[0]);
  }
  return seeded.candidateId;
}

/**
 * An order book. Row i is on order `i % orders`, so the orders interleave over the whole sheet;
 * with `orders` equal to `rows` every order has one line.
 */
async function seedOrderBook(companyId: string, customerId: string, dieId: string, opts: { rows?: number; orders?: number } = {}): Promise<string> {
  const orderCount = opts.orders ?? ORDERS;
  return seedBulk(companyId, "orders", opts.rows ?? ROWS, (i) => ({
    customer: "Party",
    oldOrderNo: `O-${i % orderCount}`,
    orderDate: "2025-10-31",
    series: "R",
    sectionCode: "8100",
    cutLength: 3000 + Math.floor(i / orderCount) * 100,
    bakiKg: 250_000,
    _ids: { customer: customerId, sectionCode: dieId },
  }));
}

describe("bounded write steps (B-new-2)", () => {
  test(`a write step of a 5,000-row interleaved order book reads at most ${STEP_ROWS_READ_MAX} rows`, async () => {
    const { companyId } = await env.seedCompany({ settings: { dieRequiredOnSalesOrder: false } });
    const customerId = await env.seedCustomer(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
    await seedOrderBook(companyId, customerId, dieId);

    const tally: Tally = { rows: 0, statements: 0 };
    const ctx = await contextFor(env, companyId, "admin");
    const { createDb } = await import("@orrn/db");
    const api = await apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);

    const { runId } = await api.ingest.merge.start();
    tally.rows = 0;
    let last = await api.ingest.merge.step({ runId, expectCursor: 0 });
    if (process.env.DEBUG_READS) console.log("PLAN READS", tally.rows);
    for (let i = 0; last.state === "planning" && i < 10; i += 1) last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
    expect(last.state).toBe("running");
    // 1,000 orders, 10 whole orders per chunk.
    expect(last.chunksTotal).toBe(ORDERS / 10);

    const reads: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      tally.rows = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      reads.push(tally.rows);
    }
    expect(last.chunksWritten).toBe(3);
    expect(last.chunksFailed).toBe(0);
    if (process.env.DEBUG_READS) console.log("STEP READS", reads);
    for (const n of reads) expect(n).toBeLessThanOrEqual(STEP_ROWS_READ_MAX);

    const { salesOrder, salesOrderLine } = await import("@orrn/db/schema/sales");
    const { eq } = await import("drizzle-orm");
    expect(await env.db.select({ id: salesOrder.id }).from(salesOrder).where(eq(salesOrder.companyId, companyId))).toHaveLength(30);
    expect(await env.db.select({ id: salesOrderLine.id }).from(salesOrderLine).where(eq(salesOrderLine.companyId, companyId))).toHaveLength(150);
    await api.ingest.merge.stop({ runId });
  }, 120_000);

  test(`the last write step of a 500-chunk run reads no more than the first one (at most ${STEP_GROWTH_MAX} rows more)`, async () => {
    const { companyId } = await env.seedCompany();
    const api0 = await apiFor(await contextFor(env, companyId, "admin"));
    const v = await api0.vendor.create({ name: "Mahadev Scrap" });
    // 10,000 vendor aliases, 20 a chunk: 500 chunks. Each is the vendor's own name, so a chunk adds
    // nothing and calls no procedure: the step's reads are the runner's own.
    await seedBulk(companyId, "vendor_aliases", 10_000, () => ({ vendor: "Mahadev Scrap", alias: "Mahadev Scrap", _ids: { vendor: v.id } }));

    const tally: Tally = { rows: 0, statements: 0 };
    const ctx = await contextFor(env, companyId, "admin");
    const { createDb } = await import("@orrn/db");
    const api = await apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
    const { runId } = await api.ingest.merge.start();
    let last = await api.ingest.merge.step({ runId, expectCursor: 0 });
    while (last.state === "planning") last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
    expect(last.chunksTotal).toBe(500);

    const reads: number[] = [];
    while (last.chunksWritten < last.chunksTotal) {
      tally.rows = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      reads.push(tally.rows);
    }
    expect(last.chunksFailed).toBe(0);
    expect(reads).toHaveLength(500);
    if (process.env.DEBUG_READS) console.log("FIRST, LAST STEP READS", reads[0], reads.at(-1), Math.max(...reads));
    for (const n of reads) expect(n).toBeLessThanOrEqual(STEP_ROWS_READ_MAX);
    // The step finds its chunk without walking the 499 chunks written before it.
    expect(reads.at(-1)!).toBeLessThanOrEqual(reads[0]! + STEP_GROWTH_MAX);
    last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
    expect(last.state).toBe("done");
  }, 300_000);

  test(`a vendors step and a vendor aliases step on a plant of 1,100 vendors and 1,000 aliases read at most ${STEP_ROWS_READ_MAX} rows`, async () => {
    const { companyId } = await env.seedCompany();
    const { vendor, vendorAlias } = await import("@orrn/db/schema/purchase");
    const { nameKey } = await import("../src/lib/purchase");
    // The plant's masters, straight into D1: 1,100 vendors, 1,000 of them with an alias.
    const live = Array.from({ length: 1_100 }, (_, i) => ({ id: `${companyId}-v${i}`, companyId, name: `Plant Vendor ${i}`, nameKey: nameKey(`Plant Vendor ${i}`) }));
    const aliases = live.slice(0, 1_000).map((v, i) => ({ id: `${v.id}-a`, companyId, vendorId: v.id, alias: `PV ${i}`, aliasKey: nameKey(`PV ${i}`) }));
    const inserts = [
      ...Array.from({ length: Math.ceil(live.length / 15) }, (_, i) => env.db.insert(vendor).values(live.slice(i * 15, i * 15 + 15))),
      ...Array.from({ length: Math.ceil(aliases.length / 15) }, (_, i) => env.db.insert(vendorAlias).values(aliases.slice(i * 15, i * 15 + 15))),
    ];
    await env.db.batch(inserts as unknown as Parameters<typeof env.db.batch>[0]);
    // One vendors chunk (20 new vendors, one already in orrn) and one vendor aliases chunk (20 aliases).
    await seedCandidate(env, companyId, "vendors", Array.from({ length: 20 }, (_, i) => ({ values: { name: i === 0 ? "PLANT VENDOR 7." : `New Vendor ${i}` } })));
    await seedCandidate(
      env,
      companyId,
      "vendor_aliases",
      Array.from({ length: 20 }, (_, i) => ({ values: { vendor: "Plant Vendor 1050", alias: i === 0 ? "plant vendor 1050" : `NV ${i}`, _ids: { vendor: live[1_050]!.id } } })),
    );

    const tally: Tally = { rows: 0, statements: 0 };
    const ctx = await contextFor(env, companyId, "admin");
    const { createDb } = await import("@orrn/db");
    const api = await apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
    const { runId } = await api.ingest.merge.start();
    tally.rows = 0;
    let last = await api.ingest.merge.step({ runId, expectCursor: 0 });
    const plan: number[] = [tally.rows];
    while (last.state === "planning") {
      tally.rows = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      plan.push(tally.rows);
    }
    expect(last.chunksTotal).toBe(2);
    const reads: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      tally.rows = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      reads.push(tally.rows);
    }
    expect(last.chunksWritten).toBe(2);
    if (process.env.DEBUG_READS) console.log("VENDOR PLAN READS", plan, "STEP READS", reads);
    for (const n of [...plan, ...reads]) expect(n).toBeLessThanOrEqual(STEP_ROWS_READ_MAX);
    // The name already in orrn is recorded against it, not added again (plan D7).
    const { and, eq } = await import("drizzle-orm");
    expect(await env.db.select({ id: vendor.id }).from(vendor).where(eq(vendor.companyId, companyId))).toHaveLength(1_119);
    expect(await env.db.select({ id: vendorAlias.id }).from(vendorAlias).where(and(eq(vendorAlias.companyId, companyId), eq(vendorAlias.vendorId, live[1_050]!.id)))).toHaveLength(19);
  }, 120_000);

  test(`a customers step and a customer aliases step on a plant of 1,100 customers and 1,000 aliases read at most ${STEP_ROWS_READ_MAX} rows`, async () => {
    const { companyId } = await env.seedCompany();
    const { customer, customerAlias } = await import("@orrn/db/schema/customers");
    const { nameKey } = await import("../src/lib/purchase");
    // The plant's masters, straight into D1: 1,100 customers, 1,000 of them with an alias.
    const live = Array.from({ length: 1_100 }, (_, i) => ({ id: `${companyId}-c${i}`, companyId, name: `Plant Party ${i}`, nameKey: nameKey(`Plant Party ${i}`) }));
    const aliases = live.slice(0, 1_000).map((c, i) => ({ id: `${c.id}-a`, companyId, customerId: c.id, alias: `PP ${i}`, aliasKey: nameKey(`PP ${i}`) }));
    const inserts = [
      ...Array.from({ length: Math.ceil(live.length / 15) }, (_, i) => env.db.insert(customer).values(live.slice(i * 15, i * 15 + 15))),
      ...Array.from({ length: Math.ceil(aliases.length / 15) }, (_, i) => env.db.insert(customerAlias).values(aliases.slice(i * 15, i * 15 + 15))),
    ];
    await env.db.batch(inserts as unknown as Parameters<typeof env.db.batch>[0]);
    // One customers chunk (20 new names, one already in orrn) and one customer aliases chunk (20 aliases).
    await seedCandidate(env, companyId, "customers", Array.from({ length: 20 }, (_, i) => ({ values: { name: i === 0 ? "PLANT PARTY 7." : `New Party ${i}` } })));
    await seedCandidate(
      env,
      companyId,
      "customer_aliases",
      Array.from({ length: 20 }, (_, i) => ({ values: { customer: "Plant Party 1050", alias: i === 0 ? "plant party 1050" : `NP ${i}`, _ids: { customer: live[1_050]!.id } } })),
    );

    const tally: Tally = { rows: 0, statements: 0 };
    const ctx = await contextFor(env, companyId, "admin");
    const { createDb } = await import("@orrn/db");
    const api = await apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
    const { runId } = await api.ingest.merge.start();
    tally.rows = 0;
    let last = await api.ingest.merge.step({ runId, expectCursor: 0 });
    const plan: number[] = [tally.rows];
    while (last.state === "planning") {
      tally.rows = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      plan.push(tally.rows);
    }
    expect(last.chunksTotal).toBe(2);
    const reads: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      tally.rows = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      reads.push(tally.rows);
    }
    expect(last.chunksWritten).toBe(2);
    if (process.env.DEBUG_READS) console.log("CUSTOMER PLAN READS", plan, "STEP READS", reads);
    for (const n of [...plan, ...reads]) expect(n).toBeLessThanOrEqual(STEP_ROWS_READ_MAX);
    const { and, eq } = await import("drizzle-orm");
    expect(await env.db.select({ id: customer.id }).from(customer).where(eq(customer.companyId, companyId))).toHaveLength(1_119);
    expect(await env.db.select({ id: customerAlias.id }).from(customerAlias).where(and(eq(customerAlias.companyId, companyId), eq(customerAlias.customerId, live[1_050]!.id)))).toHaveLength(19);
  }, 120_000);

  test("customers made before the name key existed are found by name, and their keys are filled in", async () => {
    const { companyId } = await env.seedCompany();
    const { customer } = await import("@orrn/db/schema/customers");
    const { eq } = await import("drizzle-orm");
    await env.db.insert(customer).values({ id: `${companyId}-old`, companyId, name: "Old Party Traders" });
    await seedCandidate(env, companyId, "customers", [{ values: { name: "OLD PARTY TRADERS" } }, { values: { name: "Fresh Party" } }]);
    const api = await apiFor(await contextFor(env, companyId, "admin"));
    const { runId } = await api.ingest.merge.start();
    let last = await api.ingest.merge.step({ runId, expectCursor: 0 });
    for (let i = 0; (last.state === "planning" || last.state === "running") && i < 20; i += 1) last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
    expect(last.state).toBe("done");
    const rows = await env.db.select({ name: customer.name, key: customer.nameKey }).from(customer).where(eq(customer.companyId, companyId));
    expect(rows.map((r) => [r.name, r.key]).sort()).toEqual([
      ["Fresh Party", "freshparty"],
      ["Old Party Traders", "oldpartytraders"],
    ]);
  }, 60_000);

  // Opening a row costs about 3 rows read (the mark index, the row, the index entry it leaves), so a
  // step that opens one 500-row bundles chunk cannot stay under 1,000. The bound is one chunk: at
  // most STEP_ROWS_READ_MAX plus 3 reads per row of one chunk, the same for every step, however long
  // the sheet. Before, the failing step opened every chunk of the candidate: 15,566 rows read.
  test(`a refused first chunk of a 5,000-row bundles sheet holds the candidate; that step and every drop step read one chunk's worth, and every row ends open (M-new-4)`, async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
    // Row 3 names a section that is not in orrn: chunk 1 is refused before any call.
    const candidateId = await seedBulk(companyId, "bundles", ROWS, (i) =>
      i === 2
        ? { legacyId: `L-${i}`, series: "R", sectionCode: "9999", quantity: 10, weightG: 50_000, lengthMm: 3658, _ids: {} }
        : { legacyId: `L-${i}`, series: "R", sectionCode: "8100", quantity: 10, weightG: 50_000, lengthMm: 3658, _ids: { sectionCode: dieId } },
    );
    const tally: Tally = { rows: 0, statements: 0 };
    const ctx = await contextFor(env, companyId, "admin");
    const { createDb } = await import("@orrn/db");
    const api = await apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
    const { runId } = await api.ingest.merge.start();
    let last = await api.ingest.merge.step({ runId, expectCursor: 0 });
    for (let i = 0; last.state === "planning" && i < 20; i += 1) last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
    expect(last.state).toBe("running");
    expect(last.chunksTotal).toBeGreaterThan(5);
    const reads: number[] = [];
    for (let i = 0; i < 40 && last.state === "running"; i += 1) {
      tally.rows = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      reads.push(tally.rows);
    }
    expect(last.state).toBe("done_with_holds");
    if (process.env.DEBUG_READS) console.log("HOLD AND DROP READS", reads);
    const { CHUNK_ROWS } = await import("../src/lib/ingest/merge/shared");
    for (const n of reads) expect(n).toBeLessThanOrEqual(STEP_ROWS_READ_MAX + 3 * CHUNK_ROWS.bundles.create);
    // Each drop step costs the same: no step reads more because the sheet has more chunks.
    const drops = reads.slice(1, -1);
    expect(Math.max(...drops) - Math.min(...drops)).toBeLessThanOrEqual(STEP_GROWTH_MAX);
    expect((await candidateRow(env, candidateId)).state).toBe("held");
    const staged = await stagedRows(env, candidateId);
    expect(staged.every((r) => r.mergeState === "open" && r.committedType === null)).toBe(true);
  }, 300_000);

  test(`planning 5,000 one-line orders sends at most ${PLAN_BATCH_STATEMENTS_MAX} statements in a batch and reads at most ${PLAN_ROWS_READ_MAX} rows a step (M-new-1)`, async () => {
    const { companyId } = await env.seedCompany({ settings: { dieRequiredOnSalesOrder: false } });
    const customerId = await env.seedCustomer(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
    const book = await seedOrderBook(companyId, customerId, dieId, { rows: ROWS, orders: ROWS });

    const tally: Tally = { rows: 0, statements: 0 };
    const ctx = await contextFor(env, companyId, "admin");
    const { createDb } = await import("@orrn/db");
    const api = await apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
    const { runId } = await api.ingest.merge.start();
    const steps: Tally[] = [];
    let last = { state: "planning", cursor: 0 } as Awaited<ReturnType<typeof api.ingest.merge.step>>;
    while (last.state === "planning") {
      Object.assign(tally, { rows: 0, statements: 0, maxBatch: 0 });
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      steps.push({ ...tally });
    }
    if (process.env.DEBUG_READS) console.log("PLAN STEPS", steps);
    expect(last.state).toBe("running");
    expect(last.chunksTotal).toBe(ROWS / 10);
    for (const t of steps) {
      expect(t.maxBatch!).toBeLessThanOrEqual(PLAN_BATCH_STATEMENTS_MAX);
      expect(t.rows).toBeLessThanOrEqual(PLAN_ROWS_READ_MAX);
    }
    // Every row carries the mark of its own chunk: 500 chunks of 10 rows.
    const rows = await stagedRows(env, book);
    expect(rows.every((r) => r.mergeState === "queued" && r.committedType === "ingest_merge_chunk")).toBe(true);
    const perChunk = new Map<string, number>();
    for (const r of rows) perChunk.set(r.committedId!, (perChunk.get(r.committedId!) ?? 0) + 1);
    expect(perChunk.size).toBe(ROWS / 10);
    expect([...perChunk.values()].every((n) => n === 10)).toBe(true);
    await api.ingest.merge.stop({ runId });
  }, 120_000);

  test("an orders sheet of more than 5,000 rows is held at planning, read no further (Bm5)", async () => {
    const { companyId } = await env.seedCompany({ settings: { dieRequiredOnSalesOrder: false } });
    const customerId = await env.seedCustomer(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
    const book = await seedOrderBook(companyId, customerId, dieId, { rows: 6_000, orders: 1_200 });

    const tally: Tally = { rows: 0, statements: 0 };
    const ctx = await contextFor(env, companyId, "admin");
    const { createDb } = await import("@orrn/db");
    const api = await apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
    const { runId } = await api.ingest.merge.start();
    const reads: number[] = [];
    let last = { state: "planning", cursor: 0 } as Awaited<ReturnType<typeof api.ingest.merge.step>>;
    while (last.state === "planning" || last.state === "running") {
      tally.rows = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      reads.push(tally.rows);
    }
    if (process.env.DEBUG_READS) console.log("HELD PLAN READS", reads);
    expect(last.state).toBe("done_with_holds");
    for (const n of reads) expect(n).toBeLessThanOrEqual(PLAN_ROWS_READ_MAX);
    const c = await candidateRow(env, book);
    expect(c.state).toBe("held");
    // Words changed by portal rules round 3, section 1: the limit, and what works (ORDERS_TOO_BIG).
    expect(c.reasonDetail).toBe(ORDERS_TOO_BIG);
    expect((await stagedRows(env, book)).every((r) => r.mergeState === "open" && r.committedType === null)).toBe(true);
  }, 120_000);

  test(`planning a 10,000-row sheet reads each window once: at most ${PLAN_PAGE_ROWS_READ_MAX} rows a step (Bm5)`, async () => {
    const { companyId } = await env.seedCompany();
    const api0 = await apiFor(await contextFor(env, companyId, "admin"));
    const v = await api0.vendor.create({ name: "Mahadev Scrap" });
    // 4,500 skipped rows (more than one window with nothing to plan), then 5,500 aliases.
    const sheet = await seedBulk(companyId, "vendor_aliases", 10_000, () => ({ vendor: "Mahadev Scrap", alias: "Mahadev Scrap", _ids: { vendor: v.id } }));
    const { ingestStagedRow } = await import("@orrn/db/schema/ingest");
    const { and, eq, lt } = await import("drizzle-orm");
    await env.db.update(ingestStagedRow).set({ state: "skipped" }).where(and(eq(ingestStagedRow.candidateId, sheet), lt(ingestStagedRow.rowIndex, 4_500)));

    const tally: Tally = { rows: 0, statements: 0 };
    const ctx = await contextFor(env, companyId, "admin");
    const { createDb } = await import("@orrn/db");
    const api = await apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
    const { runId } = await api.ingest.merge.start();
    const reads: number[] = [];
    let last = { state: "planning", cursor: 0 } as Awaited<ReturnType<typeof api.ingest.merge.step>>;
    while (last.state === "planning" && reads.length < 50) {
      tally.rows = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      reads.push(tally.rows);
    }
    if (process.env.DEBUG_READS) console.log("PAGE PLAN READS", reads);
    expect(last.state).toBe("running");
    expect(last.chunksTotal).toBe(5_500 / 20);
    for (const n of reads) expect(n).toBeLessThanOrEqual(PLAN_PAGE_ROWS_READ_MAX);
    const rows = await stagedRows(env, sheet);
    expect(rows.filter((r) => r.mergeState === "queued")).toHaveLength(5_500);
    expect(rows.slice(0, 4_500).every((r) => r.mergeState === "open" && r.committedType === null)).toBe(true);
    await api.ingest.merge.stop({ runId });
  }, 120_000);

  test(`recording a written chunk sends one statement per order or per ${RECORD_ROWS_PER_STATEMENT} rows, not one per row (Bm7)`, async () => {
    const { companyId } = await env.seedCompany({ settings: { dieRequiredOnSalesOrder: false } });
    const customerId = await env.seedCustomer(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
    // 10 orders of 100 lines (the largest orders chunk) and 500 new customers (the largest create chunk).
    const lines = Array.from({ length: 1_000 }, (_, i) => ({
      values: {
        customer: "Party",
        oldOrderNo: `L-${i % 10}`,
        orderDate: "2025-10-31",
        series: "R",
        sectionCode: "8100",
        cutLength: 3000 + Math.floor(i / 10),
        bakiKg: 250_000,
        _ids: { customer: customerId, sectionCode: dieId },
      },
    }));
    const orders = await seedCandidate(env, companyId, "orders", lines);
    const people = await seedCandidate(env, companyId, "customers", Array.from({ length: 500 }, (_, i) => ({ values: { name: `Bulk Party ${i}` } })));

    const tally: Tally = { rows: 0, statements: 0 };
    const ctx = await contextFor(env, companyId, "admin");
    const { createDb } = await import("@orrn/db");
    const api = await apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
    const { runId } = await api.ingest.merge.start();
    let last = await api.ingest.merge.step({ runId, expectCursor: 0 });
    while (last.state === "planning") last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
    expect(last.chunksTotal).toBe(2);

    const sent: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      tally.statements = 0;
      last = await api.ingest.merge.step({ runId, expectCursor: last.cursor });
      sent.push(tally.statements);
    }
    expect(last.chunksWritten).toBe(2);
    if (process.env.DEBUG_READS) console.log("STEP STATEMENTS", sent);
    // Customers come first (merge order). The record batch alone was 500 statements before.
    expect(sent[0]!).toBeLessThanOrEqual(CUSTOMER_STEP_STATEMENTS_MAX);
    expect(sent[1]!).toBeLessThanOrEqual(ORDER_STEP_STATEMENTS_MAX);
    const written = [...(await stagedRows(env, orders.candidateId)), ...(await stagedRows(env, people.candidateId))];
    expect(written.every((r) => r.mergeState === "written" && r.committedId && r.committedType !== "ingest_merge_chunk")).toBe(true);
    expect(new Set(written.filter((r) => r.committedType === "customer").map((r) => r.committedId)).size).toBe(500);
    expect(new Set(written.filter((r) => r.committedType === "sales_order").map((r) => r.committedId)).size).toBe(10);
    expect((await candidateRow(env, orders.candidateId)).rowsWritten).toBe(1_000);
    expect((await candidateRow(env, people.candidateId)).rowsWritten).toBe(500);
  }, 120_000);
});
