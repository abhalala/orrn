/**
 * Server round 11 (PORTAL-S-CHECK-9, rule 11.3).
 * - S9-1: a skip made by "Skip these {count} lines" counts only while the file's answer is No.
 * - S9-2: a discarded sheet brought back into orders meets the rule 11.3 guard.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, plant, pump, rowsOf, trim, upload, type Caller } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

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
const R = (no: string, po: string, date: string, sec: string, cut = "3658") => ["Acme Traders", no, po, date, "R", sec, cut, "100"];
const TWO = (no: string, a: string, b: string) => [R(no, a, "01/05/2023", "5100"), R(no, "", "", "5101"), R(no, b, "01/06/2024", "5102"), R(no, "", "", "5103")];

async function setup() {
  const p = await plant(env);
  await p.owner.customer.create({ name: "Acme Traders" });
  for (const code of ["5100", "5101", "5102", "5103"]) await env.seedDie(p.companyId, { series: "R", sectionCode: code });
  await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", BOOK, FIELDS, ["customer", "oldOrderNo", "orderDate"]), "Book");
  return p;
}

const seqOf = async (as: Caller, candidateId: string) => (await as.ingest.candidate.get({ candidateId })).serverSeq;
const fill = async (as: Caller, candidateId: string, answer: boolean) =>
  as.ingest.answer.set({ candidateId, questionCode: "order_fill_above", subject: "", answer, expectSeq: await seqOf(as, candidateId) });
const setTarget = async (as: Caller, candidateId: string, target: "orders" | "customers" | "ignore") =>
  as.ingest.candidate.setTarget({ candidateId, target, expectSeq: await seqOf(as, candidateId) });
const skipNoDate = async (as: Caller, candidateId: string) => as.ingest.rows.skipNoDate({ candidateId, expectSeq: await seqOf(as, candidateId) });

async function tryApprove(as: Caller, candidateId: string): Promise<string> {
  try {
    await as.ingest.candidate.approve({ candidateId, expectSeq: await seqOf(as, candidateId) });
    return "approved";
  } catch (e) {
    return `REFUSED: ${(e as Error).message}`;
  }
}

const ASK_FIRST = "Answer every question first";

/** R2 alone, No, then the bulk skip: rows 1 and 3 are skipped with the mark. */
async function skippedUnderNo(p: Awaited<ReturnType<typeof setup>>) {
  const up = await upload(p.owner, [{ name: "A", headers: BOOK, rows: TWO("41", "PO-A", "PO-B") }]);
  const a = up.candidates[0]!.id;
  await pump(p.owner, a);
  await fill(p.owner, a, false);
  await pump(p.owner, a);
  expect((await skipNoDate(p.owner, a)).skipped).toBe(2);
  await pump(p.owner, a);
  expect((await rowsOf(p.owner, a)).map((r) => r.state)).toEqual(["ready_create", "skipped", "ready_create", "skipped"]);
  return { ...up, a };
}

const marks = async (candidateId: string) =>
  Number(
    (await env.d1.prepare("select count(*) as n from ingest_staged_row where candidate_id = ? and (bulk_skip is not null or decision = 'skip')").bind(candidateId).first<{ n: number }>())!.n,
  );

async function waitsOnQuestion(as: Caller, a: string) {
  const rows = await rowsOf(as, a);
  expect([rows[1]!.state, rows[3]!.state]).toEqual(["ambiguous", "ambiguous"]);
  expect(rows[1]!.reasons).toContain("q:order_fill_above");
  expect(rows[3]!.reasons).toContain("q:order_fill_above");
  expect(await tryApprove(as, a)).toBe(`REFUSED: ${ASK_FIRST}`);
}

describe("S9-1: a bulk skip counts only while the file's answer is No", () => {
  test("repro 1: the only sheet set to customers (answer cleared) and back to orders: rows 1 and 3 wait on the question", async () => {
    const p = await setup();
    const { a } = await skippedUnderNo(p);
    await setTarget(p.owner, a, "customers");
    expect(await marks(a)).toBe(0);
    await setTarget(p.owner, a, "orders");
    await pump(p.owner, a);
    await waitsOnQuestion(p.owner, a);
  });

  test("repro 2: the only sheet ignored (answer cleared) and brought back: rows 1 and 3 wait on the question", async () => {
    const p = await setup();
    const { a } = await skippedUnderNo(p);
    await setTarget(p.owner, a, "ignore");
    expect(await marks(a)).toBe(0);
    await setTarget(p.owner, a, "orders");
    await pump(p.owner, a);
    await waitsOnQuestion(p.owner, a);
  });

  test("repro 3: A leaves orders, Yes on B, A comes back: rows 1 and 3 are filled from above", async () => {
    const p = await setup();
    const up = await upload(p.owner, [
      { name: "A", headers: BOOK, rows: TWO("41", "PO-A", "PO-B") },
      { name: "B", headers: BOOK, rows: TWO("43", "PO-D", "PO-E") },
    ]);
    const [a, b] = [up.candidates[0]!.id, up.candidates[1]!.id];
    await pump(p.owner, a);
    await pump(p.owner, b);
    await fill(p.owner, a, false);
    await pump(p.owner, a);
    await pump(p.owner, b);
    expect((await skipNoDate(p.owner, a)).skipped).toBe(2);
    await pump(p.owner, a);
    await setTarget(p.owner, a, "customers");
    await pump(p.owner, b);
    await fill(p.owner, b, true);
    await setTarget(p.owner, a, "orders");
    await pump(p.owner, a);
    const rows = await rowsOf(p.owner, a);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create", "ready_create"]);
    expect(rows[1]!.reasons).toContain("filled_down:orderDate");
    expect(rows[3]!.reasons).toContain("filled_down:orderDate");
  });

  test("any path: a marked skip on a sheet whose file answer is Yes is checked again by the dry run", async () => {
    const p = await setup();
    const up = await upload(p.owner, [{ name: "A", headers: BOOK, rows: TWO("41", "PO-A", "PO-B") }]);
    const a = up.candidates[0]!.id;
    await pump(p.owner, a);
    await fill(p.owner, a, true);
    await pump(p.owner, a);
    // A path that forgot to clear the marks: the rows say skipped by the bulk action, the file says Yes.
    await env.d1.prepare("update ingest_staged_row set decision = 'skip', bulk_skip = 'no_date' where candidate_id = ? and row_index in (1, 3)").bind(a).run();
    await env.d1.prepare("update ingest_candidate set state = 'processing', dry_cursor = 0 where id = ?").bind(a).run();
    await pump(p.owner, a);
    const rows = await rowsOf(p.owner, a);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create", "ready_create"]);
    expect(rows[1]!.reasons).toContain("filled_down:orderDate");
    expect(await marks(a)).toBe(0);
  });

  test("under No the marked skip still counts", async () => {
    const p = await setup();
    const { a } = await skippedUnderNo(p);
    await env.d1.prepare("update ingest_candidate set state = 'processing', dry_cursor = 0 where id = ?").bind(a).run();
    await pump(p.owner, a);
    expect((await rowsOf(p.owner, a)).map((r) => r.state)).toEqual(["ready_create", "skipped", "ready_create", "skipped"]);
    expect(await marks(a)).toBe(2);
  });
});

const TABLES_LOCKED = "A sheet of this file is approved. Its tables cannot change now.";

describe("S9-2: a discarded sheet brought back into orders meets the guard", () => {
  test("Yes on A, B approved, A discarded: setting A to orders is refused", async () => {
    const p = await setup();
    const up = await upload(p.owner, [
      { name: "A", headers: BOOK, rows: TWO("41", "PO-A", "PO-B") },
      { name: "B", headers: BOOK, rows: TWO("43", "PO-D", "PO-E") },
    ]);
    const [a, b] = [up.candidates[0]!.id, up.candidates[1]!.id];
    await pump(p.owner, a);
    await pump(p.owner, b);
    await fill(p.owner, a, true);
    await pump(p.owner, a);
    await pump(p.owner, b);
    expect(await tryApprove(p.owner, b)).toBe("approved");
    await p.owner.ingest.candidate.discard({ candidateId: a, expectSeq: await seqOf(p.owner, a) });
    await expect(setTarget(p.owner, a, "orders")).rejects.toThrow(TABLES_LOCKED);
    expect((await p.owner.ingest.candidate.get({ candidateId: a })).state).toBe("discarded");
  });
});
