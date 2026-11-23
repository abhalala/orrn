/**
 * Rule 4.4 (PORTAL-RULES-3), dry run steps: every dry run step of a 5,000-row sheet of each target
 * reads at most DRY_STEP_MAX rows, the last at most DRY_LAST_PER_ROW a row of the sheet more, and
 * sends at most 400 statements a batch. The write steps are in ingest-bounded-targets.test.ts; the
 * shared fixture is ingest-bounded-targets-fixture.ts.
 */
import { describe, expect } from "bun:test";

import type { IngestTarget } from "@orrn/db/schema/ingest";

import { newTally, resetTally, type Tally } from "./ingest-count-helpers";
import { BOOK, bookLayout, boundedTargetsFile, DRY_LAST_PER_ROW, DRY_STEP_MAX, n, ROWS, SHEETS } from "./ingest-bounded-targets-fixture";

const f = boundedTargetsFile();
const { test, api, uploadSheet, dryRun, expectDryBounded } = f;

describe("rule 4.4: every dry run step of a 5,000-row sheet is bounded, the last too", () => {
  async function plant() {
    const { companyId, users } = await f.env().seedCompany();
    const owner = f.env().caller({ role: "owner", companyId });
    await owner.customer.create({ name: "Acme Traders" });
    await owner.vendor.create({ name: "Mahadev Scrap" });
    await f.env().seedDie(companyId, { series: "R", sectionCode: "8100" });
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
    for (let i = 0; i < many.length; i += 20) inserts.push(f.env().db.insert(customer).values(many.slice(i, i + 20)));
    for (let i = 0; i < inserts.length; i += 100) await f.env().db.batch(inserts.slice(i, i + 100) as unknown as Parameters<ReturnType<typeof f.env>["db"]["batch"]>[0]);
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
    const c = await f.env().caller({ role: "owner", companyId: p.companyId }).ingest.candidate.get({ candidateId: id });
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
    const as = f.env().caller({ role: "owner", companyId: p.companyId });
    expect((await as.ingest.candidate.get({ candidateId: second })).counts.conflict).toBe(ROWS);
    expect((await as.ingest.candidate.get({ candidateId: first })).counts.conflict).toBe(ROWS);
  }, 900_000);
});
