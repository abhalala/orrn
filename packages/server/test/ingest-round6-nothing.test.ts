/**
 * Rule 7.4 (PORTAL-RULES-3, round 6): a sheet in which no row would be written (all refused or
 * skipped) cannot be approved. Discarding it frees the file: the same file can be uploaded and
 * checked again. The checker's Z (PORTAL-S-CHECK-5, S5-6) is the first test.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, plant, pump, rowsOf, sha, trim, upload, type Caller } from "./ingest-portal-helpers";

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
const R = (no: string, po: string, sec: string) => ["Acme Traders", no, po, "31/10/2025", "R", sec, "3658", "100"];
const NOTHING = "Nothing in this sheet can be imported. Fix the rows or discard it.";

async function setup() {
  const p = await plant(env);
  await p.owner.customer.create({ name: "Acme Traders" });
  for (const code of ["5100", "5101", "5102", "5103"]) await env.seedDie(p.companyId, { series: "R", sectionCode: code });
  await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", BOOK, FIELDS, ["customer", "oldOrderNo", "orderDate"]), "Book");
  return p;
}

const seqOf = async (as: Caller, candidateId: string) => (await as.ingest.candidate.get({ candidateId })).serverSeq;

async function tryApprove(as: Caller, candidateId: string): Promise<string> {
  try {
    await as.ingest.candidate.approve({ candidateId, expectSeq: await seqOf(as, candidateId) });
    return "approved";
  } catch (e) {
    return `REFUSED: ${(e as Error).message}`;
  }
}

describe("rule 7.4: nothing to import cannot be approved; discarding frees the file", () => {
  test("Z: one old order of 150 lines, every line refused: approve refuses; discard; the same file is read again", async () => {
    const p = await setup();
    const rows = Array.from({ length: 150 }, (_, i) => R("41", i === 0 ? "PO-9" : "", ["5100", "5101", "5102", "5103"][i % 4]!));
    const h = sha();
    const first = await upload(p.owner, [{ name: "Book", headers: BOOK, rows }], "book.xlsx", h);
    const id = first.candidates[0]!.id;
    await pump(p.owner, id);
    expect(new Set((await rowsOf(p.owner, id)).map((r) => r.state))).toEqual(new Set(["refused"]));
    expect(await tryApprove(p.owner, id)).toBe(`REFUSED: ${NOTHING}`);
    await p.owner.ingest.candidate.discard({ candidateId: id, expectSeq: await seqOf(p.owner, id) });
    // The same bytes again: read from the start, not the discarded sheet.
    const again = await p.owner.ingest.artifact.begin({ sha256: h, fileName: "book.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
    expect(again).toMatchObject({ artifactId: first.artifactId, existing: false });
    const fresh = await upload(p.owner, [{ name: "Book", headers: BOOK, rows: rows.slice(0, 100) }], "book.xlsx", h);
    expect(fresh.artifactId).toBe(first.artifactId);
    const id2 = fresh.candidates[0]!.id;
    expect(id2).not.toBe(id);
    await pump(p.owner, id2);
    expect(new Set((await rowsOf(p.owner, id2)).map((r) => r.state))).toEqual(new Set(["ready_create"]));
  });

  test("every row skipped by a person: approve refuses with the same words", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ name: "Book", headers: BOOK, rows: [R("41", "PO-9", "5100"), R("42", "PO-8", "5101")] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    const rows = await rowsOf(p.owner, id);
    await p.owner.ingest.rows.decide({ candidateId: id, rowIds: rows.map((r) => r.id), decision: "skip", expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    expect(await tryApprove(p.owner, id)).toBe(`REFUSED: ${NOTHING}`);
  });

  test("a sheet of one sheet discarded and another still open does not free the file", async () => {
    const p = await setup();
    const h = sha();
    const { artifactId, candidates } = await upload(
      p.owner,
      [
        { name: "Book", headers: BOOK, rows: [R("41", "PO-9", "5100")] },
        { name: "Book 2", headers: BOOK, rows: [R("43", "PO-7", "5100")] },
      ],
      "two.xlsx",
      h,
    );
    await p.owner.ingest.candidate.discard({ candidateId: candidates[0]!.id, expectSeq: await seqOf(p.owner, candidates[0]!.id) });
    const again = await p.owner.ingest.artifact.begin({ sha256: h, fileName: "two.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
    expect(again).toMatchObject({ artifactId, existing: true });
  });
});
