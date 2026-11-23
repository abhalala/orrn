/**
 * Rule 4.4 (PORTAL-RULES-3), write steps: every merge write step of a 5,000-row sheet of each target
 * reads a number of rows bounded by a constant plus a constant a chunk row, the last step as the
 * first, and sends at most 400 statements a batch. The dry run steps are in
 * ingest-bounded-targets-dry.test.ts; the shared fixture is ingest-bounded-targets-fixture.ts.
 */
import { describe, expect } from "bun:test";

import type { IngestTarget } from "@orrn/db/schema/ingest";

import { seedBulk } from "./ingest-count-helpers";
import { boundedTargetsFile, ROWS, SEED_VALUES, WRITE_BASE, WRITE_PER_ROW } from "./ingest-bounded-targets-fixture";

const { test, env, mergeWrites, expectWritesBounded, plantFor } = boundedTargetsFile();

/**
 * Vendors, vendor aliases and die copies write 20 rows a chunk (250 steps for 5,000 rows), and the
 * order book 10 orders a chunk: 270 to 420 s each on a normal GitHub runner, about 1.45x that on the
 * slower ones (vendors passed 600 s there, CI run 45099150888). 1,200 s is twice the slowest pass.
 */
const WRITE_LIMIT_MS = 1_200_000;

describe("rule 4.4: every write step of a 5,000-row sheet is bounded, the last as the first", () => {
  for (const target of Object.keys(SEED_VALUES) as Exclude<IngestTarget, "orders">[]) {
    test(`${target}: each write step reads at most ${WRITE_BASE} plus ${WRITE_PER_ROW} a chunk row`, async () => {
      const p = await plantFor(target);
      await seedBulk(env(), p.companyId, target, ROWS, (i) => SEED_VALUES[target](i, p.x));
      expectWritesBounded(target, target, await mergeWrites(p.companyId));
    }, WRITE_LIMIT_MS);
  }

  test("orders: each write step of 2,500 two-line orders reads a bounded page", async () => {
    const p = await plantFor("orders");
    await seedBulk(env(), p.companyId, "orders", ROWS, (i) => ({
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
  }, WRITE_LIMIT_MS);
});
