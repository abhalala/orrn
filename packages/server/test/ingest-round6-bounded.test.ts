/**
 * Rule 7.3 (PORTAL-RULES-3, round 6): no step reads every customer, vendor, die or order book of the
 * plant. A plant with 20,000 customers and a 5,000-row order book waiting; a 1-row sheet's dry run,
 * merge and discard read rows under the bounds stated here (PORTAL-S-CHECK-5, S5-3, S5-4, S5-5).
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { counting, newTally, resetTally, seedBulk, type Tally } from "./ingest-count-helpers";
import { apiFor, contextFor } from "./ingest-merge-fixture";
import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, putBlocksPicked, putRowsAs, trim } from "./ingest-portal-helpers";
import { nameKey } from "../src/lib/purchase";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 120_000);

afterAll(async () => {
  await env.dispose();
});

const CUSTOMERS = 20_000;
const WAITING = 5_000;
/**
 * Rows one step of a 1-row sheet may read, whatever the plant holds. Measured: 67 at most for a
 * known party, 103 for a party not in orrn (its neighbours by key are read for near names).
 */
const ONE_ROW_STEP_MAX = 150;

const BOOK = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
const FIELDS = [
  { field: "customer", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "customer_by_name" as const }] },
  { field: "oldOrderNo", steps: trim },
  { field: "poNumber", steps: trim },
  { field: "orderDate", steps: [{ op: "date" as const, format: "dmy" as const }] },
  { field: "series", steps: [{ op: "trim" as const }, { op: "case" as const, to: "upper" as const }] },
  { field: "sectionCode", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "section_by_code" as const }] },
  { field: "cutLength", steps: [{ op: "number" as const, kind: "length" as const, unit: "mm" }] },
  { field: "bakiKg", steps: [{ op: "number" as const, kind: "mass" as const, unit: "kg" }] },
];
const ALIASES = ["Party", "Also called"];

let plant: { companyId: string; ownerId: string; names: string[] };

async function seedCustomers(companyId: string, n: number): Promise<string[]> {
  const names: string[] = [];
  for (let i = 0; i < n; i += 2000) {
    const statements = [];
    for (let j = i; j < Math.min(n, i + 2000); j += 20) {
      const vals: string[] = [];
      const args: unknown[] = [];
      for (let k = j; k < Math.min(n, j + 20); k++) {
        const name = `Shree Metals ${k}`;
        names.push(name);
        vals.push("(?, ?, ?, ?)");
        args.push(`c6-${companyId.slice(-6)}-${k}`, companyId, name, nameKey(name));
      }
      statements.push(env.d1.prepare(`insert into customer (id, company_id, name, name_key) values ${vals.join(",")}`).bind(...args));
    }
    await env.d1.batch(statements);
  }
  return names;
}

beforeAll(async () => {
  const { companyId, users } = await env.seedCompany();
  const owner = env.caller({ role: "owner", companyId });
  await owner.customer.create({ name: "Acme Traders" });
  await env.seedDie(companyId, { series: "R", sectionCode: "5100" });
  await learnLayout(env, companyId, users.owner.id, layout("orders", BOOK, FIELDS, ["customer", "oldOrderNo", "orderDate"]), "Book");
  await learnLayout(
    env,
    companyId,
    users.owner.id,
    layout("customer_aliases", ALIASES, [{ field: "customer", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "customer_by_name" as const }] }, { field: "alias", steps: trim }], ["alias"]),
    "Aliases",
  );
  const names = await seedCustomers(companyId, CUSTOMERS);
  // A 5,000-row order book waits, ready, with orders of other parties.
  const book = await seedBulk(env, companyId, "orders", WAITING, (i) => ({
    customer: names[i % names.length],
    oldOrderNo: String(i + 1),
    poNumber: `PO-W${i}`,
    orderDate: "2025-10-31",
    _ids: { customer: `c6-${companyId.slice(-6)}-${i % names.length}` },
  }));
  await env.d1.prepare("update ingest_candidate set state = 'ready' where id = ?").bind(book).run();
  plant = { companyId, ownerId: users.owner.id, names };
}, 600_000);

async function counted(tally: Tally) {
  const ctx = await contextFor(env, plant.companyId, "owner");
  const { createDb } = await import("@orrn/db");
  return apiFor({ ...ctx, db: createDb(counting(env.d1, tally)) } as typeof ctx);
}

async function oneRowSheet(headers: string[], row: string[], fileName: string) {
  const as = env.caller({ role: "owner", companyId: plant.companyId });
  const begin = await as.ingest.artifact.begin({ sha256: createHash("sha256").update(randomUUID()).digest("hex"), fileName, sizeBytes: 100, contentType: null, kind: "sheet" });
  const put = await putBlocksPicked(as, { artifactId: begin.artifactId, blocks: [{ ordinal: 0, sheetName: "S", title: null, headerRow: 0, headerRows: 1, headers, rowCount: 1, sample: [row] }] });
  await putRowsAs(as, { blockId: put.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: [row] });
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  return put.candidates[0]!.id;
}

async function dryRunMax(candidateId: string): Promise<number[]> {
  const tally = newTally();
  const a = await counted(tally);
  let cursor = (await a.ingest.candidate.get({ candidateId })).dryCursor;
  const steps: number[] = [];
  for (let i = 0; i < 20; i++) {
    resetTally(tally);
    const out = await a.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    steps.push(tally.rows);
    if (out.done) break;
    cursor = out.cursor;
  }
  return steps;
}

describe("rule 7.3: a 1-row sheet reads a bounded number of rows on a plant of 20,000 customers and a waiting 5,000-row book", () => {
  test("S5-3: a 1-row order book's dry run step", async () => {
    const id = await oneRowSheet(BOOK, [plant.names[123]!, "9001", "PO-X", "31/10/2025", "R", "5100", "3658", "100"], "one.xlsx");
    const steps = await dryRunMax(id);
    expect(Math.max(...steps)).toBeLessThan(ONE_ROW_STEP_MAX);
  }, 300_000);

  test("S5-3: a party name not in orrn reads only its neighbours by key, and still gets near names to pick from", async () => {
    const id = await oneRowSheet(BOOK, ["Shree Metals 12x", "9002", "PO-Y", "31/10/2025", "R", "5100", "3658", "100"], "near.xlsx");
    expect(Math.max(...(await dryRunMax(id)))).toBeLessThan(ONE_ROW_STEP_MAX);
    const as = env.caller({ role: "owner", companyId: plant.companyId });
    const [row] = (await as.ingest.rows.list({ candidateId: id, limit: 5 })).items;
    expect(row!.state).toBe("ambiguous");
    expect(row!.options.map((o) => o.label)).toContain("Shree Metals 12");
  }, 300_000);

  test("S5-3: a 1-row aliases sheet's dry run step; S5-4: its write step", async () => {
    const id = await oneRowSheet(ALIASES, [plant.names[77]!, "Shree M 77"], "aliases.xlsx");
    expect(Math.max(...(await dryRunMax(id)))).toBeLessThan(ONE_ROW_STEP_MAX);
    const tally = newTally();
    const a = await counted(tally);
    await a.ingest.candidate.approve({ candidateId: id, expectSeq: (await a.ingest.candidate.get({ candidateId: id })).serverSeq });
    const { runId } = await a.ingest.merge.start();
    let cursor = 0;
    const steps: number[] = [];
    for (let i = 0; i < 20; i++) {
      resetTally(tally);
      const s = await a.ingest.merge.step({ runId, expectCursor: cursor });
      steps.push(tally.rows);
      cursor = s.cursor;
      if (s.state !== "planning" && s.state !== "running") {
        expect(s.state).toBe("done");
        break;
      }
    }
    expect(Math.max(...steps)).toBeLessThan(ONE_ROW_STEP_MAX);
  }, 300_000);

  test("S5-5: merging and discarding a 1-row book touch the waiting book only by its keys", async () => {
    const merged = await oneRowSheet(BOOK, ["Acme Traders", "9101", "PO-M", "31/10/2025", "R", "5100", "3658", "100"], "merge.xlsx");
    await dryRunMax(merged);
    const tally = newTally();
    const a = await counted(tally);
    await a.ingest.candidate.approve({ candidateId: merged, expectSeq: (await a.ingest.candidate.get({ candidateId: merged })).serverSeq });
    const { runId } = await a.ingest.merge.start();
    let cursor = 0;
    const steps: number[] = [];
    for (let i = 0; i < 20; i++) {
      resetTally(tally);
      const s = await a.ingest.merge.step({ runId, expectCursor: cursor });
      steps.push(tally.rows);
      cursor = s.cursor;
      if (s.state !== "planning" && s.state !== "running") break;
    }
    expect(Math.max(...steps)).toBeLessThan(ONE_ROW_STEP_MAX);
    const gone = await oneRowSheet(BOOK, ["Acme Traders", "9102", "PO-D", "31/10/2025", "R", "5100", "3658", "100"], "discard.xlsx");
    await dryRunMax(gone);
    resetTally(tally);
    await a.ingest.candidate.discard({ candidateId: gone, expectSeq: (await a.ingest.candidate.get({ candidateId: gone })).serverSeq });
    expect(tally.rows).toBeLessThan(ONE_ROW_STEP_MAX);
  }, 300_000);
});
