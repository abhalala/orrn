/**
 * Infinity Portal merge, lane B (B-new-2): every write step reads a bounded, indexed page. The
 * rows a step reads are counted from D1's own `meta.rows_read` (Miniflare reports it like
 * production). A 5,000-row order book whose 1,000 orders interleave over the whole sheet is the
 * worst case for the old range scan: every chunk's row range spans almost the whole candidate.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { apiFor, contextFor, seedCandidate } from "./ingest-merge-fixture";

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

const ROWS = 5_000;
const ORDERS = 1_000;

type Tally = { rows: number };

/**
 * A D1 binding that adds up `meta.rows_read` of every statement. `raw()` and `first()` return no
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
            const res = await (target[prop] as () => Promise<D1Result>).call(target);
            add(res.meta, query);
            return res;
          };
        }
        if (prop === "raw" || prop === "first") {
          return async (...args: unknown[]) => {
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

/** Staged order rows straight into D1, 8 rows per insert (under 100 bound parameters). */
async function seedOrderBook(companyId: string, customerId: string, dieId: string): Promise<string> {
  const seeded = await seedCandidate(env, companyId, "orders", []);
  const { ingestStagedRow } = await import("@orrn/db/schema/ingest");
  const rows = Array.from({ length: ROWS }, (_, i) => {
    const order = i % ORDERS;
    const lineNo = Math.floor(i / ORDERS);
    return {
      id: `b${seeded.candidateId}-${i}`,
      companyId,
      rowKey: `k${seeded.candidateId}-${i}`,
      candidateId: seeded.candidateId,
      rowIndex: i,
      raw: [],
      values: {
        customer: "Party",
        oldOrderNo: `O-${order}`,
        orderDate: "2025-10-31",
        series: "R",
        sectionCode: "8100",
        cutLength: 3000 + lineNo * 100,
        bakiKg: 250_000,
        _ids: { customer: customerId, sectionCode: dieId },
      },
      state: "ready_create" as const,
    };
  });
  const inserts = [];
  for (let i = 0; i < rows.length; i += 8) inserts.push(env.db.insert(ingestStagedRow).values(rows.slice(i, i + 8)));
  for (let i = 0; i < inserts.length; i += 100) {
    const part = inserts.slice(i, i + 100);
    await env.db.batch(part as unknown as Parameters<typeof env.db.batch>[0]);
  }
  return seeded.candidateId;
}

describe("bounded write steps (B-new-2)", () => {
  test(`a write step of a 5,000-row interleaved order book reads at most ${STEP_ROWS_READ_MAX} rows`, async () => {
    const { companyId } = await env.seedCompany({ settings: { dieRequiredOnSalesOrder: false } });
    const customerId = await env.seedCustomer(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
    await seedOrderBook(companyId, customerId, dieId);

    const tally: Tally = { rows: 0 };
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
});
