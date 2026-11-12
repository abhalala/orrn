/**
 * Server round 9 (PORTAL-S-CHECK-7 and PORTAL-RULES-3 section 11).
 * - 11.1 (S7-1): the fill answer belongs to the file. When it changes, or a re-put or a pick drops it,
 *   every other order sheet of the file that is processing, ready or held is checked again. It cannot
 *   change once a sheet of the file is approved, merging or merged.
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
const CHANGE_REFUSED = "A sheet of this file is approved. Its answers cannot change now.";

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

describe("rule 11.1 (S7-1): the fill answer belongs to the file", () => {
  test("way 1: No on A after Yes sends B back; B's blank lines are refused, not written with the Yes fill", async () => {
    const p = await setup();
    const { a, b } = await twoSheetsYes(p);
    await fill(p.owner, a, false);
    expect(await stateOf(p.owner, b)).toBe("processing");
    await pump(p.owner, a);
    await pump(p.owner, b);
    expect(await refusedNoDate(p.owner, b, "43")).toEqual(["refused", true, "refused", true]);
  });

  test("way 2: B approved under Yes: the answer cannot change", async () => {
    const p = await setup();
    const { a, b } = await twoSheetsYes(p);
    expect(await tryApprove(p.owner, b)).toBe("approved");
    await expect(fill(p.owner, a, false)).rejects.toThrow(CHANGE_REFUSED);
    // The same answer again changes nothing and is taken.
    await fill(p.owner, a, true);
    expect(await stateOf(p.owner, b)).toBe("approved");
  });

  test("way 3: a re-put that changes A drops its answer: B goes back, asks again, and No on the new A refuses B's lines", async () => {
    const p = await setup();
    const { artifactId, a, b } = await twoSheetsYes(p);
    const blocks = (await p.owner.ingest.artifact.get({ artifactId })).blocks.map((x) => ({
      ordinal: x.ordinal,
      sheetName: x.sheetName,
      title: null,
      headerRow: 0,
      headerRows: 1,
      rowCount: x.rowCount,
      sample: x.sample,
      preview: [{ row: 0, cells: BOOK }, ...x.sample.map((cells, i) => ({ row: i + 1, cells }))],
    }));
    const again = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [{ ...blocks[0]!, hint: { headerRow: 0, headerRows: 1, lastDataRow: 4, skipRows: [] } }, blocks[1]!] });
    expect(await stateOf(p.owner, b)).toBe("processing");
    await putRowsAs(p.owner, { blockId: again.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: TWO("41", "PO-A", "PO-B") });
    await p.owner.ingest.artifact.complete({ artifactId });
    const a2 = again.candidates.find((c) => c.blockOrdinal === 0)!.id;
    expect(a2).not.toBe(a);
    await pump(p.owner, a2);
    await pump(p.owner, b);
    expect((await rowsOf(p.owner, b))[1]!.reasons).toContain("q:order_fill_above");
    await fill(p.owner, a2, false);
    await pump(p.owner, a2);
    await pump(p.owner, b);
    expect(await refusedNoDate(p.owner, b, "43")).toEqual(["refused", true, "refused", true]);
  });

  test("a pick on A drops its answer too: B goes back and asks again", async () => {
    const p = await setup();
    const { a, b } = await twoSheetsYes(p);
    await p.owner.ingest.candidate.repickHeader({ candidateId: a, expectSeq: await seqOf(p.owner, a) });
    expect(await stateOf(p.owner, b)).toBe("processing");
  });

  test("way 4: No sent on a customers sheet of the file does not leave the order sheet on Yes", async () => {
    const p = await setup();
    const up = await upload(p.owner, [
      { name: "A", headers: BOOK, rows: TWO("41", "PO-A", "PO-B") },
      { name: "C", headers: ["Name", "City"], rows: [["Om Metals", "Rajkot"]] },
    ]);
    const [a, c] = [up.candidates[0]!.id, up.candidates[1]!.id];
    await pump(p.owner, a);
    await fill(p.owner, a, true);
    await pump(p.owner, a);
    await pump(p.owner, c);
    await fill(p.owner, c, false);
    await pump(p.owner, a);
    expect(await refusedNoDate(p.owner, a, "41")).toEqual(["refused", true, "refused", true]);
  });
});
