/**
 * Counting helpers for the bounded tests (PORTAL-RULES-3 rule 4.4): a D1 binding that adds up
 * `meta.rows_read` and counts statements and batch sizes, and a bulk seed of staged rows. Same
 * method as ingest-merge-bounded.test.ts.
 */
import type { IngestTarget } from "@orrn/db/schema/ingest";

import type { TestEnv } from "./harness";
import { seedCandidate } from "./ingest-merge-fixture";
import { orderKeyOf } from "../src/lib/ingest/merge/shared";

/** Rows D1 read, statements sent, the largest batch. */
export type Tally = { rows: number; statements: number; maxBatch: number; log?: { q: string; rows: number }[] };

export const newTally = (): Tally => ({ rows: 0, statements: 0, maxBatch: 0 });
export const resetTally = (t: Tally) => Object.assign(t, newTally(), t.log ? { log: [] } : {});

/**
 * A D1 binding that adds up `meta.rows_read` of every statement. `raw()` and `first()` return no
 * meta, so a select read that way is also run once with `all()` to learn its rows read.
 */
export function counting(d1: D1Database, tally: Tally): D1Database {
  const real = new WeakMap<object, D1PreparedStatement>();
  const queries = new WeakMap<object, string>();
  const add = (meta: { rows_read?: number } | undefined, q = "") => {
    tally.rows += Number(meta?.rows_read ?? 0);
    tally.log?.push({ q, rows: Number(meta?.rows_read ?? 0) });
    if (process.env.DEBUG_READS && Number(meta?.rows_read ?? 0) > 300) console.log("READS", meta?.rows_read, q.slice(0, 300));
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
          tally.maxBatch = Math.max(tally.maxBatch, statements.length);
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

/** Staged rows straight into D1, ready to merge, 8 rows per insert (under 100 bound parameters). */
export async function seedBulk(env: TestEnv, companyId: string, target: IngestTarget, total: number, valuesAt: (i: number) => Record<string, unknown>): Promise<string> {
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
