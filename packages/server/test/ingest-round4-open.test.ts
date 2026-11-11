/**
 * What the round 4 checker left open (S3-1 to S3-7), each driven through the real ingest procedures
 * on real D1, from the checker's own reproductions. No model and no network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { approve, layout, learnLayout, mergeOnce, plant, pump, rowsOf, trim, upload, type Caller } from "./ingest-portal-helpers";

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
      "select o.po_number as po, o.note, o.status, (select count(*) from sales_order_line l where l.sales_order_id = o.id) as lines from sales_order o where o.company_id = ? order by o.created_at, o.id",
    )
    .bind(companyId)
    .all<{ po: string | null; note: string | null; lines: number; status: string }>();
  return r.results.map((o) => ({ po: o.po, note: o.note, lines: Number(o.lines), status: o.status }));
}

async function tryApprove(as: Caller, id: string): Promise<string> {
  try {
    return (await approve(as, id)).state;
  } catch (e) {
    return `REFUSED: ${(e as Error).message}`;
  }
}

describe("S3-1 and S3-5: one identity is one sales order", () => {
  test("an order number on the first row only, with the PO on every row, is one order of 3 lines", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ headers: BOOK, rows: [R("41", "PO-9", "31/10/2025", "5100"), R("", "PO-9", "31/10/2025", "5101"), R("", "PO-9", "31/10/2025", "5102")] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create"]);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    const m = await mergeOnce(p.owner);
    expect(m.state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-9", note: "Old order no. 41", lines: 3, status: expect.any(String) }]);
  });

  test("a row with no order number whose PO is on two numbered orders is refused, never a partial order", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ headers: BOOK, rows: [R("41", "PO-9", "31/10/2025", "5100"), R("42", "PO-9", "31/10/2025", "5101"), R("", "PO-9", "31/10/2025", "5102")] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    const rows = await rowsOf(p.owner, id);
    expect(rows[2]).toMatchObject({ state: "refused" });
    expect(rows[2]!.reasons).toContain("order_no_unclear:oldOrderNo");
    // Order 42 shares the PO with order 41: refused as before.
    expect(rows[1]!.state).toBe("refused");
  });

  test("a row with no order number and a PO no numbered row has stays an order by customer and PO", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ headers: BOOK, rows: [R("41", "PO-9", "31/10/2025", "5100"), R("", "PO-77", "31/10/2025", "5101"), R("", "PO-77", "31/10/2025", "5102")] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create"]);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect((await orders(p.companyId)).map((o) => [o.po, o.lines])).toEqual([
      ["PO-9", 1],
      ["PO-77", 2],
    ]);
  });

  test("one numbered order with a PO and two dates in one financial year is one order of 2 lines", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ headers: BOOK, rows: [R("41", "PO-9", "01/10/2025", "5100"), R("41", "", "05/10/2025", "5101")] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create"]);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-9", note: "Old order no. 41", lines: 2, status: expect.any(String) }]);
  });
});

describe("S3-3: an order the plant cancelled can be imported again", () => {
  test("order 41 merged, then cancelled; a second file with order 41 makes one new order of 2 lines", async () => {
    const p = await setup();
    const A = await upload(p.owner, [{ name: "A", headers: BOOK, rows: [R("41", "", "31/10/2025", "5100")] }], "wrong.xlsx");
    const a = A.candidates[0]!.id;
    await pump(p.owner, a);
    expect(await tryApprove(p.owner, a)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    const so = await env.d1.prepare("select id from sales_order where company_id = ?").bind(p.companyId).first<{ id: string }>();
    await p.owner.orders.cancel({ id: so!.id, reason: "imported wrong" });
    const B = await upload(p.owner, [{ name: "B", headers: BOOK, rows: [R("41", "", "31/10/2025", "5101"), R("41", "", "31/10/2025", "5102")] }], "right.xlsx");
    const b = B.candidates[0]!.id;
    await pump(p.owner, b);
    expect((await rowsOf(p.owner, b)).map((r) => r.state)).toEqual(["ready_create", "ready_create"]);
    expect(await tryApprove(p.owner, b)).toBe("approved");
    const m = await mergeOnce(p.owner);
    const cb = await p.owner.ingest.candidate.get({ candidateId: b });
    expect([m.state, cb.state, cb.reasonDetail]).toEqual(["done", "merged", null]);
    expect((await orders(p.companyId)).map((o) => [o.status, o.lines])).toEqual([
      ["cancelled", 1],
      [expect.not.stringMatching(/^cancelled$/), 2],
    ]);
  });
});
