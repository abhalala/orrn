/**
 * Server round 10 (PORTAL-S-CHECK-8 and PORTAL-RULES-3 rule 11.3).
 * - 11.3 (S8-1): the fill answer is stored once, on the file. No operation on one sheet (re-put,
 *   pick, set target, discard) brings back an older answer from another sheet.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, plant, pump, putRowsAs, rowsOf, trim, upload, type Caller } from "./ingest-portal-helpers";

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
const stateOf = async (as: Caller, candidateId: string) => (await as.ingest.candidate.get({ candidateId })).state;
const fill = async (as: Caller, candidateId: string, answer: boolean) =>
  as.ingest.answer.set({ candidateId, questionCode: "order_fill_above", subject: "", answer, expectSeq: await seqOf(as, candidateId) });

async function tryApprove(as: Caller, candidateId: string): Promise<string> {
  try {
    await as.ingest.candidate.approve({ candidateId, expectSeq: await seqOf(as, candidateId) });
    return "approved";
  } catch (e) {
    return `REFUSED: ${(e as Error).message}`;
  }
}

/** Two order sheets, both with a run of two dates; both checked and answered Yes on A. */
async function twoSheetsYes(p: Awaited<ReturnType<typeof setup>>) {
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
  expect((await rowsOf(p.owner, b)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create", "ready_create"]);
  return { ...up, a, b };
}

const refusedNoDate = async (as: Caller, candidateId: string, no: string) => {
  const rows = await rowsOf(as, candidateId);
  return [rows[1]!.state, rows[1]!.reasons.includes(`order_no_date:${no}`), rows[3]!.state, rows[3]!.reasons.includes(`order_no_date:${no}`)];
};


/** The file's stored answer, and how many answers sit on sheets (none, since round 10). */
async function stored(artifactId: string) {
  const a = await env.d1.prepare("select fill_above as f from ingest_artifact where id = ?").bind(artifactId).first<{ f: string | null }>();
  const n = await env.d1
    .prepare("select count(*) as n from ingest_answer where question_code = 'order_fill_above' and candidate_id in (select id from ingest_candidate where artifact_id = ?)")
    .bind(artifactId)
    .first<{ n: number }>();
  return { file: a?.f ? (JSON.parse(a.f) as { answer: boolean }).answer : null, onSheets: Number(n!.n) };
}

const blocksOf = async (as: Caller, artifactId: string) =>
  (await as.ingest.artifact.get({ artifactId })).blocks.map((x) => ({
    ordinal: x.ordinal,
    sheetName: x.sheetName,
    title: null,
    headerRow: 0,
    headerRows: 1,
    rowCount: x.rowCount,
    sample: x.sample,
    preview: [{ row: 0, cells: BOOK }, ...x.sample.map((cells, i) => ({ row: i + 1, cells }))],
  }));

describe("rule 11.3 (S8-1): one stored answer per file", () => {
  test("Yes on A, No on B, then B put again with a pick: the file stays on No, A and the new B are refused, nothing is filled", async () => {
    const p = await setup();
    const { artifactId, a, b } = await twoSheetsYes(p);
    await fill(p.owner, b, false);
    await pump(p.owner, a);
    expect(await refusedNoDate(p.owner, a, "41")).toEqual(["refused", true, "refused", true]);
    expect(await stored(artifactId)).toEqual({ file: false, onSheets: 0 });
    const blocks = await blocksOf(p.owner, artifactId);
    const again = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [blocks[0]!, { ...blocks[1]!, hint: { headerRow: 0, headerRows: 1, lastDataRow: 4, skipRows: [] } }] });
    await putRowsAs(p.owner, { blockId: again.blocks[1]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: TWO("43", "PO-D", "PO-E") });
    await p.owner.ingest.artifact.complete({ artifactId });
    const b2 = again.candidates.find((c) => c.blockOrdinal === 1)!.id;
    await pump(p.owner, a);
    await pump(p.owner, b2);
    expect(await refusedNoDate(p.owner, a, "41")).toEqual(["refused", true, "refused", true]);
    expect(await refusedNoDate(p.owner, b2, "43")).toEqual(["refused", true, "refused", true]);
    for (const id of [a, b2]) {
      expect((await rowsOf(p.owner, id)).some((r) => r.reasons.includes("filled_down:orderDate"))).toBe(false);
      expect((await p.owner.ingest.candidate.get({ candidateId: id })).questions.find((q) => q.code === "order_fill_above")).toMatchObject({ answer: false, open: false });
    }
    expect(await stored(artifactId)).toEqual({ file: false, onSheets: 0 });
    expect((await p.owner.ingest.artifact.get({ artifactId })).fillAbove).toMatchObject({ answer: false, by: p.users.owner.id });
    expect(await tryApprove(p.owner, a)).toStartWith("REFUSED:");
  });

  test("Yes on A, No on B, then a pick on B: A goes back and stays on No", async () => {
    const p = await setup();
    const { artifactId, a, b } = await twoSheetsYes(p);
    await fill(p.owner, b, false);
    await pump(p.owner, a);
    await p.owner.ingest.candidate.repickHeader({ candidateId: b, expectSeq: await seqOf(p.owner, b) });
    expect(await stateOf(p.owner, a)).toBe("processing");
    expect(await stored(artifactId)).toEqual({ file: false, onSheets: 0 });
  });

  test("with no order sheet left the answer is cleared: a discard, and a pick on the only order sheet", async () => {
    const p = await setup();
    const one = async () => {
      const up = await upload(p.owner, [{ name: "A", headers: BOOK, rows: TWO("41", "PO-A", "PO-B") }]);
      const a = up.candidates[0]!.id;
      await pump(p.owner, a);
      await fill(p.owner, a, true);
      expect(await stored(up.artifactId)).toEqual({ file: true, onSheets: 0 });
      return { artifactId: up.artifactId, a };
    };
    const d = await one();
    await p.owner.ingest.candidate.discard({ candidateId: d.a, expectSeq: await seqOf(p.owner, d.a) });
    expect(await stored(d.artifactId)).toEqual({ file: null, onSheets: 0 });
    const k = await one();
    await p.owner.ingest.candidate.repickHeader({ candidateId: k.a, expectSeq: await seqOf(p.owner, k.a) });
    expect(await stored(k.artifactId)).toEqual({ file: null, onSheets: 0 });
  });
});
