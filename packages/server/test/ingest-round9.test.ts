/**
 * Server round 9 (PORTAL-S-CHECK-7 and PORTAL-RULES-3 section 11).
 * - 11.1 (S7-1): the fill answer belongs to the file. When it changes, or a re-put or a pick drops it,
 *   every other order sheet of the file that is processing, ready or held is checked again. It cannot
 *   change once a sheet of the file is approved, merging or merged.
 * - 11.2: after "No" the orders of that number wait; one action, "Skip these {count} lines", skips
 *   every line refused with `order_no_date` on the sheet, and the dated orders then write whole.
 * - S7-4: a run longer than the page window: its lines that took a date from above wait on the
 *   question on every page, not only on the page that sees the second date.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, mergeOnce, plant, pump, putRowsAs, rowsOf, trim, upload, type Caller } from "./ingest-portal-helpers";

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

  // S7-3 (round 9 item 4): the question is asked only on order sheets, so way 4 is now refused.
  test("way 4: No sent on a customers sheet of the file is refused; the order sheet keeps its answer", async () => {
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
    expect((await p.owner.ingest.candidate.get({ candidateId: c })).questions.some((q) => q.code === "order_fill_above")).toBe(false);
    await expect(fill(p.owner, c, false)).rejects.toThrow("This import does not ask that");
    expect(await stateOf(p.owner, a)).toBe("ready");
    // An answer stored on a non-order sheet does not count for the file.
    await env.d1
      .prepare("insert into ingest_answer (id, company_id, candidate_id, question_code, subject, answer, answered_by, answered_at) values (?, ?, ?, 'order_fill_above', '', 'false', ?, ?)")
      .bind(crypto.randomUUID(), p.companyId, c, p.users.owner.id, Date.now() + 60_000)
      .run();
    expect((await p.owner.ingest.candidate.get({ candidateId: a })).questions.find((q) => q.code === "order_fill_above")).toMatchObject({ answer: true });
  });
});

/** Each live order: its date, PO and the section codes of its lines in code order. */
async function orders(companyId: string) {
  const r = await env.d1
    .prepare(
      `select o.order_date as d, o.po_number as po, (select group_concat(code, ',') from (select d.section_code as code from sales_order_line l join die d on d.id = l.die_id where l.sales_order_id = o.id order by d.section_code)) as codes
       from sales_order o where o.company_id = ? order by o.order_date`,
    )
    .bind(companyId)
    .all<{ d: string; po: string | null; codes: string | null }>();
  return r.results.map((o) => ({ date: o.d, po: o.po, codes: o.codes }));
}

describe("rule 11.2: one action skips every line with no date", () => {
  test("after No: the count is on the sheet, one skip takes both lines, then the dated orders write whole", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ name: "A", headers: BOOK, rows: TWO("41", "PO-A", "PO-B") }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    await fill(p.owner, id, false);
    await pump(p.owner, id);
    expect(await tryApprove(p.owner, id)).toStartWith("REFUSED:");
    expect((await p.owner.ingest.candidate.get({ candidateId: id })).noDateLines).toBe(2);
    // A manager may not; an admin may.
    await expect(p.as("manager").ingest.rows.skipNoDate({ candidateId: id, expectSeq: await seqOf(p.owner, id) })).rejects.toThrow();
    const out = await p.admin.ingest.rows.skipNoDate({ candidateId: id, expectSeq: await seqOf(p.owner, id) });
    expect(out.skipped).toBe(2);
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "skipped", "ready_create", "skipped"]);
    expect((await p.owner.ingest.candidate.get({ candidateId: id })).noDateLines).toBe(0);
    const audit = await env.d1.prepare("select meta from audit_log where company_id = ? and action = 'ingest.rows.skip_no_date'").bind(p.companyId).first<{ meta: string }>();
    expect(JSON.parse(audit!.meta)).toMatchObject({ count: 2 });
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([
      { date: "2023-05-01", po: "PO-A", codes: "5100" },
      { date: "2024-06-01", po: "PO-B", codes: "5102" },
    ]);
    // Nothing left to skip.
    await expect(p.owner.ingest.rows.skipNoDate({ candidateId: id, expectSeq: await seqOf(p.owner, id) })).rejects.toThrow();
  });

  test("a sheet with no such line refuses the action", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ name: "A", headers: BOOK, rows: [R("44", "PO-44", "01/05/2025", "5100")] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    expect((await p.owner.ingest.candidate.get({ candidateId: id })).noDateLines).toBe(0);
    await expect(p.owner.ingest.rows.skipNoDate({ candidateId: id, expectSeq: await seqOf(p.owner, id) })).rejects.toThrow("No line on this sheet is missing a date");
  });
});

describe("S7-4: a run longer than the page window", () => {
  test("a run of 41 over 330 lines with a 2024 date at line 320: the first page's filled lines ask too; No refuses them", async () => {
    const p = await setup();
    const rows = Array.from({ length: 330 }, (_, i) =>
      i === 0 ? R("41", "PO-A", "01/05/2023", "5100", "3000") : i === 320 ? R("41", "PO-B", "01/06/2024", "5100", "3320") : R("41", "", "", "5100", String(3000 + i)),
    );
    const { candidates } = await upload(p.owner, [{ name: "A", headers: BOOK, rows }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    const at = async (i: number) => {
      const r = await env.d1.prepare("select state, reasons from ingest_staged_row where candidate_id = ? and row_index = ?").bind(id, i).first<{ state: string; reasons: string }>();
      return { state: r!.state, reasons: JSON.parse(r!.reasons ?? "[]") as string[] };
    };
    expect((await at(150)).reasons).toContain("q:order_fill_above");
    // Line 250's nearest date (line 0) is out of its page's reach: it is not filled from it, but
    // refused for its missing date, and it holds the orders of 41 like any dateless line.
    expect((await at(250)).reasons).toContain("order_no_date:41");
    await fill(p.owner, id, false);
    await pump(p.owner, id);
    const after = await at(150);
    expect([after.state, after.reasons.includes("order_no_date:41")]).toEqual(["refused", true]);
  }, 120_000);
});
