/**
 * What the round 5 checker left open (S4-1 to S4-4), built to PORTAL-RULES-3 section 4, each driven
 * through the real ingest procedures on real D1 from the checker's own reproductions. No model and
 * no network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { approve, DIE_HEADERS, dieLayout, layout, learnLayout, mergeOnce, ORDER_HEADERS, orderLayout, plant, pump, rowsOf, trim, upload, type Caller } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const LINE_FIELDS = [
  { field: "series", steps: [{ op: "trim" as const }, { op: "case" as const, to: "upper" as const }] },
  { field: "sectionCode", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "section_by_code" as const }] },
  { field: "cutLength", steps: [{ op: "number" as const, kind: "length" as const, unit: "mm" }] },
  { field: "bakiKg", steps: [{ op: "number" as const, kind: "mass" as const, unit: "kg" }] },
];
const party = { field: "customer", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "customer_by_name" as const }] };
const date = { field: "orderDate", steps: [{ op: "date" as const, format: "dmy" as const }] };
const BOOK = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
const bookLayout = () =>
  layout("orders", BOOK, [party, { field: "oldOrderNo", steps: trim }, { field: "poNumber", steps: trim }, date, ...LINE_FIELDS], ["customer", "oldOrderNo", "orderDate"]);
const R = (no: string, po: string, d: string, sec: string, who = "Acme Traders") => [who, no, po, d, "R", sec, "3658", "100"];

async function setup() {
  const p = await plant(env);
  await p.owner.customer.create({ name: "Acme Traders" });
  for (const c of ["5100", "5101", "5102", "5103"]) await env.seedDie(p.companyId, { series: "R", sectionCode: c });
  await learnLayout(env, p.companyId, p.users.owner.id, bookLayout(), "Book");
  return p;
}

async function orders(companyId: string) {
  const r = await env.d1
    .prepare(
      "select o.po_number as po, o.note, (select count(*) from sales_order_line l where l.sales_order_id = o.id) as lines from sales_order o where o.company_id = ? order by o.created_at, o.id",
    )
    .bind(companyId)
    .all<{ po: string | null; note: string | null; lines: number }>();
  return r.results.map((o) => ({ po: o.po, note: o.note, lines: Number(o.lines) }));
}

async function tryApprove(as: Caller, id: string): Promise<string> {
  try {
    return (await approve(as, id)).state;
  } catch (e) {
    return `REFUSED: ${(e as Error).message}`;
  }
}

async function decide(as: Caller, candidateId: string, rowIds: string[], decision: "skip" | "keep_file" | "keep_live") {
  const c = await as.ingest.candidate.get({ candidateId });
  await as.ingest.rows.decide({ candidateId, rowIds, decision, expectSeq: c.serverSeq });
  await pump(as, candidateId);
}

/** Each row as [state, the pass reason, the sheet it names]. */
async function shown(as: Caller, id: string) {
  return (await rowsOf(as, id)).map((r) => [
    r.state,
    (r.reasons ?? []).find((x) => x.startsWith("order_in_other_file") || x.startsWith("po_on_two_orders")) ?? null,
    ((r.values as Record<string, unknown> | null)?._otherFile as { sheetName?: string } | undefined)?.sheetName ?? null,
  ]);
}

describe("S4-1 and rule 4.2: a PO joins the numbered order that carries it, across sheets", () => {
  test("T1: order 41 with PO-9 in sheet A, PO-only rows of PO-9 in sheet B: both sides show the other sheet, never a partial order", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [
      { name: "A", headers: BOOK, rows: [R("41", "PO-9", "31/10/2025", "5100")] },
      { name: "B", headers: BOOK, rows: [R("", "PO-9", "31/10/2025", "5101"), R("", "PO-9", "31/10/2025", "5102")] },
    ]);
    const [a, b] = [candidates[0]!.id, candidates[1]!.id];
    await pump(p.owner, a);
    await pump(p.owner, b);
    expect(await shown(p.owner, a)).toEqual([["conflict", "order_in_other_file:order", "B"]]);
    expect(await shown(p.owner, b)).toEqual([
      ["conflict", "order_in_other_file:order", "A"],
      ["conflict", "order_in_other_file:order", "A"],
    ]);
    expect(await tryApprove(p.owner, a)).toStartWith("REFUSED");
    expect(await tryApprove(p.owner, b)).toStartWith("REFUSED");
    // The person keeps sheet B's rows and skips sheet A's: one order of 2 lines, no hold.
    await decide(p.owner, a, (await rowsOf(p.owner, a)).map((r) => r.id), "skip");
    await decide(p.owner, b, (await rowsOf(p.owner, b)).map((r) => r.id), "keep_file");
    expect(await tryApprove(p.owner, b)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-9", note: null, lines: 2 }]);
  });

  test("T1 the other way: sheet B checked first, then sheet A; both sides still show the other sheet", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [
      { name: "A", headers: BOOK, rows: [R("41", "PO-9", "31/10/2025", "5100")] },
      { name: "B", headers: BOOK, rows: [R("", "PO-9", "31/10/2025", "5101"), R("", "PO-9", "31/10/2025", "5102")] },
    ]);
    const [a, b] = [candidates[0]!.id, candidates[1]!.id];
    await pump(p.owner, b);
    await pump(p.owner, a);
    expect(await shown(p.owner, a)).toEqual([["conflict", "order_in_other_file:order", "B"]]);
    expect((await shown(p.owner, b)).map((x) => x[0])).toEqual(["conflict", "conflict"]);
    // Both kept: the planner holds the later sheet, so the order is never written twice.
    await decide(p.owner, a, (await rowsOf(p.owner, a)).map((r) => r.id), "keep_file");
    await decide(p.owner, b, (await rowsOf(p.owner, b)).map((r) => r.id), "keep_file");
    expect(await tryApprove(p.owner, a)).toBe("approved");
    expect(await tryApprove(p.owner, b)).toBe("approved");
    const m = await mergeOnce(p.owner);
    expect(m.state).toBe("done_with_holds");
    const cb = await p.owner.ingest.candidate.get({ candidateId: b });
    expect(cb.state).toBe("held");
    expect(cb.reasonDetail).toContain("book.xlsx (A)");
  });

  test("T2: order 41 with PO-9 in sheet A and order 42 with PO-9 in sheet B: a conflict naming both, nothing written for either", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [
      { name: "A", headers: BOOK, rows: [R("41", "PO-9", "31/10/2025", "5100")] },
      { name: "B", headers: BOOK, rows: [R("42", "PO-9", "31/10/2025", "5101")] },
    ]);
    const [a, b] = [candidates[0]!.id, candidates[1]!.id];
    await pump(p.owner, a);
    await pump(p.owner, b);
    expect(await shown(p.owner, a)).toEqual([["conflict", "po_on_two_orders:poNumber", "B"]]);
    expect(await shown(p.owner, b)).toEqual([["conflict", "po_on_two_orders:poNumber", "A"]]);
    expect(await tryApprove(p.owner, a)).toStartWith("REFUSED");
    expect(await tryApprove(p.owner, b)).toStartWith("REFUSED");
    await decide(p.owner, b, (await rowsOf(p.owner, b)).map((r) => r.id), "skip");
    await decide(p.owner, a, (await rowsOf(p.owner, a)).map((r) => r.id), "keep_file");
    expect(await tryApprove(p.owner, a)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-9", note: "Old order no. 41", lines: 1 }]);
  });

  test("one PO on two numbered orders in one sheet is a conflict on both orders", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ headers: BOOK, rows: [R("41", "PO-9", "31/10/2025", "5100"), R("42", "PO-9", "31/10/2025", "5101")] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    expect((await shown(p.owner, id)).map((x) => [x[0], x[1]])).toEqual([
      ["conflict", "po_on_two_orders:poNumber"],
      ["conflict", "po_on_two_orders:poNumber"],
    ]);
    // Skipping one order's rows clears the other at once.
    await decide(p.owner, id, [(await rowsOf(p.owner, id))[1]!.id], "skip");
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "skipped"]);
  });

  test("a PO-only row joins a numbered order of the same financial year only", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ headers: BOOK, rows: [R("41", "PO-9", "31/03/2025", "5100"), R("", "PO-9", "10/04/2025", "5101")] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    // 2024-25 and 2025-26: two orders with one PO, so a conflict, not one order of 2 lines.
    expect((await shown(p.owner, id)).map((x) => [x[0], x[1]])).toEqual([
      ["conflict", "po_on_two_orders:poNumber"],
      ["conflict", "po_on_two_orders:poNumber"],
    ]);
  });

  test("a numbered order whose PO is on a live imported order with another number is a conflict, not a line of that order", async () => {
    const p = await setup();
    const A = await upload(p.owner, [{ name: "A", headers: BOOK, rows: [R("41", "PO-9", "31/10/2025", "5100")] }], "first.xlsx");
    await pump(p.owner, A.candidates[0]!.id);
    expect(await tryApprove(p.owner, A.candidates[0]!.id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    const B = await upload(p.owner, [{ name: "B", headers: BOOK, rows: [R("42", "PO-9", "31/10/2025", "5101")] }], "second.xlsx");
    const b = B.candidates[0]!.id;
    await pump(p.owner, b);
    const rows = await rowsOf(p.owner, b);
    expect(rows.map((r) => r.state)).toEqual(["conflict"]);
    expect(rows[0]!.reasons).toContain("po_on_live_order:poNumber");
    expect(rows[0]!.reasons).not.toContain("order_line_new");
  });
});

describe("S4-4 and rule 4.3: approve waits only on a sheet that may matter, and names it", () => {
  async function bookPlant() {
    const p = await plant(env);
    await p.owner.customer.create({ name: "Acme Traders" });
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    await learnLayout(env, p.companyId, p.users.owner.id, dieLayout(), "Dies");
    await learnLayout(env, p.companyId, p.users.owner.id, orderLayout(), "Orders");
    return p;
  }
  const BOOK_ROWS = [
    ["Acme Traders", "PO-1", "01/10/2025", "R", "5100", "3658", "", "300"],
    // A typo: letter O for zero. No die sheet anywhere holds 51OO.
    ["Acme Traders", "PO-1", "01/10/2025", "R", "51OO", "3658", "", "300"],
  ];

  test("T6: an unread die sheet of another upload that does not hold the code never blocks the order book", async () => {
    const p = await bookPlant();
    await upload(p.owner, [{ name: "Old dies", headers: DIE_HEADERS, rows: [["R", "7000", "2.0", "2.4"]] }], "old-dies.xlsx");
    const O = await upload(p.owner, [{ name: "Book", headers: ORDER_HEADERS, rows: BOOK_ROWS }], "book.xlsx");
    const o = O.candidates[0]!.id;
    await pump(p.owner, o);
    expect((await rowsOf(p.owner, o)).map((r) => r.state)).toEqual(["ready_create", "refused"]);
    expect(await tryApprove(p.owner, o)).toBe("approved");
  });

  test("an unread die sheet of another upload whose rows hold the code blocks, naming its file and sheet", async () => {
    const p = await bookPlant();
    await upload(p.owner, [{ name: "Old dies", headers: DIE_HEADERS, rows: [["R", "51OO", "2.0", "2.4"]] }], "old-dies.xlsx");
    const O = await upload(p.owner, [{ name: "Book", headers: ORDER_HEADERS, rows: BOOK_ROWS }], "book.xlsx");
    const o = O.candidates[0]!.id;
    await pump(p.owner, o);
    expect(await tryApprove(p.owner, o)).toBe(
      "REFUSED: old-dies.xlsx (Old dies) is still being checked and may add section 51OO. Finish it or discard it, then check this sheet again.",
    );
  });

  test("an unread die sheet of the same upload blocks, naming it", async () => {
    const p = await bookPlant();
    const { candidates } = await upload(p.owner, [
      { name: "Dies", headers: DIE_HEADERS, rows: [["R", "7000", "2.0", "2.4"]] },
      { name: "Book", headers: ORDER_HEADERS, rows: BOOK_ROWS },
    ]);
    const o = candidates[1]!.id;
    await pump(p.owner, o);
    expect(await tryApprove(p.owner, o)).toBe("REFUSED: book.xlsx (Dies) of this upload is still being checked. Finish it first, then check this sheet again.");
  });
});
