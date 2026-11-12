/**
 * Rule 7.1 (PORTAL-RULES-3, round 6): an old order is written whole, or not at all. Fields of the
 * whole order (party, order date, PO) fill down inside one order's run only. A refused or open line
 * holds every other line of its order; a person may leave a line out on purpose with "Skip this
 * row", and the order then carries a note. The checker's M2, M3, I8b and Y4 (PORTAL-S-CHECK-5,
 * S5-1) are the first tests: never one order with 1 of its 3 lines.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, mergeOnce, plant, pump, rowsOf, trim, upload, type Caller } from "./ingest-portal-helpers";

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
const R = (no: string, po: string, date: string, sec: string, party = "Acme Traders", cut = "3658") => [party, no, po, date, "R", sec, cut, "100"];

async function setup() {
  const p = await plant(env);
  await p.owner.customer.create({ name: "Acme Traders" });
  for (const code of ["5100", "5101", "5102", "5103"]) await env.seedDie(p.companyId, { series: "R", sectionCode: code });
  await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", BOOK, FIELDS, ["customer", "oldOrderNo", "orderDate"]), "Book");
  return p;
}

async function orders(companyId: string) {
  const r = await env.d1
    .prepare(
      "select o.po_number as po, o.order_date as d, (select count(*) from sales_order_line l where l.sales_order_id = o.id) as lines from sales_order o where o.company_id = ? order by o.created_at, o.id",
    )
    .bind(companyId)
    .all<{ po: string | null; d: string; lines: number }>();
  return r.results.map((o) => ({ po: o.po, date: o.d, lines: Number(o.lines) }));
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

async function book(as: Caller, rows: string[][], merged?: { col: number; firstRow: number; lastRow: number }[]) {
  const { candidates } = await upload(as, [{ headers: BOOK, rows, name: "Book", merged }]);
  const id = candidates[0]!.id;
  await pump(as, id);
  return id;
}

describe("rule 7.1: an old order is written whole, or not at all", () => {
  test("M2: party, order no, PO and date merged over three rows give one order of three lines", async () => {
    const p = await setup();
    const id = await book(
      p.owner,
      [R("41", "PO-9", "01/10/2025", "5100"), R("", "", "", "5101", ""), R("", "", "", "5102", "")],
      [0, 1, 2, 3].map((col) => ({ col, firstRow: 0, lastRow: 2 })),
    );
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create"]);
    expect(rows[1]!.reasons).toEqual(expect.arrayContaining(["merged_cell:oldOrderNo", "filled_down:customer", "filled_down:orderDate", "filled_down:poNumber"]));
    expect((await p.owner.ingest.candidate.get({ candidateId: id })).counts.filled).toBe(2);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-9", date: "2025-10-01", lines: 3 }]);
  });

  test("M3: order no and date merged, party on every row: one order of three lines", async () => {
    const p = await setup();
    const id = await book(
      p.owner,
      [R("41", "PO-9", "01/10/2025", "5100"), R("", "", "", "5101"), R("", "", "", "5102")],
      [
        { col: 1, firstRow: 0, lastRow: 2 },
        { col: 3, firstRow: 0, lastRow: 2 },
      ],
    );
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create"]);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-9", date: "2025-10-01", lines: 3 }]);
  });

  test("I8b: the number on every row, the date on the first only, no merge information: the date fills down inside the order", async () => {
    const p = await setup();
    const id = await book(p.owner, [R("41", "PO-9", "01/10/2025", "5100"), R("41", "", "", "5101"), R("41", "", "", "5102")]);
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create"]);
    expect(rows[2]!.reasons).toContain("filled_down:orderDate");
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-9", date: "2025-10-01", lines: 3 }]);
    // Y4: the same order imported again is all on the live order; nothing is missing from it.
    const again = await book(p.owner, [R("41", "PO-9", "01/10/2025", "5100"), R("41", "", "", "5101"), R("41", "", "", "5102")]);
    expect((await rowsOf(p.owner, again)).map((r) => [r.state, r.reasons.includes("order_exists")])).toEqual([
      ["unchanged", true],
      ["unchanged", true],
      ["unchanged", true],
    ]);
  });

  test("never across two order numbers, never from position: a blank number with no merge stays its own row", async () => {
    const p = await setup();
    const id = await book(p.owner, [R("41", "PO-9", "01/10/2025", "5100"), R("42", "", "", "5101"), R("", "", "", "5102")]);
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "refused", "refused"]);
    expect(rows[1]!.reasons).toContain("blank_required:orderDate");
    expect(rows[1]!.reasons.some((x) => x.startsWith("filled_down:"))).toBe(false);
  });

  test("a refused line holds its order: the other lines wait, approve says so; skipping the line imports the rest with a note", async () => {
    const p = await setup();
    const id = await book(p.owner, [R("41", "PO-9", "01/10/2025", "5100"), R("41", "", "01/10/2025", "5101"), R("41", "", "01/10/2025", "5102", "Acme Traders", "abc")]);
    let rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ambiguous", "ambiguous", "refused"]);
    expect(rows[0]!.reasons).toContain("order_waits:1");
    expect(await tryApprove(p.owner, id)).toBe("REFUSED: 2 lines wait on other lines of their order. Fix the file, answer, or skip those lines first.");
    await expect(p.owner.ingest.rows.decide({ candidateId: id, rowIds: [rows[0]!.id], decision: "keep_file", expectSeq: await seqOf(p.owner, id) })).rejects.toThrow(
      "This line waits on other lines of its order. Fix or skip those lines first.",
    );
    await p.owner.ingest.rows.decide({ candidateId: id, rowIds: [rows[2]!.id], decision: "skip", expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ready_create", "skipped"]);
    expect(rows[0]!.reasons).toContain("order_skipped_lines:1");
    expect((await p.owner.ingest.candidate.get({ candidateId: id })).counts.skippedByPerson).toBe(1);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-9", date: "2025-10-01", lines: 2 }]);
    const audit = await env.d1
      .prepare("select json_extract(meta, '$.source.skippedLines') as n, json_extract(meta, '$.source.note') as note from audit_log where company_id = ? and json_extract(meta, '$.source.skippedLines') is not null")
      .bind(p.companyId)
      .all<{ n: number; note: string }>();
    expect(audit.results).toEqual([{ n: 1, note: "Imported without 1 line the person skipped" }]);
  });

  test("a refused line elsewhere in the sheet (not next to the order) still holds it", async () => {
    const p = await setup();
    const id = await book(p.owner, [R("41", "PO-9", "01/10/2025", "5100"), R("50", "", "01/10/2025", "5101"), R("41", "", "01/10/2025", "5102", "Acme Traders", "abc")]);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ambiguous", "ready_create", "refused"]);
  });

  test("two different dates inside one order's run are a conflict; keeping the file's values on every row clears it", async () => {
    const p = await setup();
    const id = await book(p.owner, [R("41", "PO-9", "01/10/2025", "5100"), R("41", "", "02/10/2025", "5101")]);
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["conflict", "conflict"]);
    expect(rows[0]!.reasons).toContain("order_run_differs:orderDate");
    expect(await tryApprove(p.owner, id)).toStartWith("REFUSED:");
    await p.owner.ingest.rows.decide({ candidateId: id, rowIds: rows.map((r) => r.id), decision: "keep_file", expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create"]);
  });

  test("a skip on a row refused before the dry run makes it skipped", async () => {
    const p = await setup();
    const id = await book(p.owner, [R("41", "PO-9", "01/10/2025", "5100", "Acme Traders", "abc"), R("50", "", "01/10/2025", "5101"), R("51", "", "01/10/2025", "5102")]);
    const [r0] = await rowsOf(p.owner, id);
    expect(r0!.state).toBe("refused");
    await p.owner.ingest.rows.decide({ candidateId: id, rowIds: [r0!.id], decision: "skip", expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id))[0]!.state).toBe("skipped");
  });
});
