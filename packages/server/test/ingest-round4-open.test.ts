/**
 * What the round 4 checker left open (S3-1 to S3-7), each driven through the real ingest procedures
 * on real D1, from the checker's own reproductions. No model and no network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { approve, countOf, DIE_HEADERS, dieLayout, layout, learnLayout, mergeOnce, ORDER_HEADERS, orderLayout, plant, pump, rowsOf, trim, upload, type Caller } from "./ingest-portal-helpers";

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
    // Order 42 shares the PO with order 41: a conflict on both orders, so nothing of either is
    // written until a person answers (rule 4.2; it was refused on order 42 only).
    expect(rows[0]!.state).toBe("conflict");
    expect(rows[1]!.state).toBe("conflict");
    expect(rows[1]!.reasons).toContain("po_on_two_orders:poNumber");
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
    // Rule 7.1 (round 6): two dates inside one order's run are a conflict until the person keeps the
    // file's values on each row. Then the one identity is one order of 2 lines, as before.
    const held = await rowsOf(p.owner, id);
    expect(held.map((r) => [r.state, r.reasons.includes("order_run_differs:orderDate")])).toEqual([
      ["conflict", true],
      ["conflict", true],
    ]);
    const seq = (await p.owner.ingest.candidate.get({ candidateId: id })).serverSeq;
    await p.owner.ingest.rows.decide({ candidateId: id, rowIds: held.map((r) => r.id), decision: "keep_file", expectSeq: seq });
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

describe("S3-4: an order book approved while its die sheet waits on an answer", () => {
  test("approve refuses the order book with plain words; once the die sheet is answered, both merge with both lines", async () => {
    const p = await plant(env);
    await p.owner.customer.create({ name: "Acme Traders" });
    await learnLayout(env, p.companyId, p.users.owner.id, dieLayout(), "Dies");
    await learnLayout(env, p.companyId, p.users.owner.id, orderLayout(), "Orders");
    const { candidates } = await upload(p.owner, [
      // 0.17 and 0.2 kg/12ft: the die sheet asks whether that unit is right.
      { name: "Dies", headers: DIE_HEADERS, rows: [["R", "9100", "0.17", "0.2"]] },
      {
        name: "Order book",
        headers: ORDER_HEADERS,
        rows: [
          ["Acme Traders", "PO-1", "01/10/2025", "R", "9100", "3658", "", "300"],
          ["Acme Traders", "PO-1", "01/10/2025", "R", "9100", "4877", "", "200"],
        ],
      },
    ]);
    const [dies, book] = [candidates[0]!.id, candidates[1]!.id];
    await pump(p.owner, dies);
    let dc = await p.owner.ingest.candidate.get({ candidateId: dies });
    expect(dc.questions.some((q) => q.code === "magnitude_check" && q.open)).toBe(true);
    await pump(p.owner, book);
    expect((await rowsOf(p.owner, book)).map((r) => r.state)).toEqual(["refused", "refused"]);
    // Rule 4.3: the words name the file and sheet the order book waits on.
    expect(await tryApprove(p.owner, book)).toBe("REFUSED: book.xlsx (Dies) adds section 9100 and is still being checked. Finish it first, then check this sheet again.");
    for (const q of dc.questions.filter((x) => x.open)) {
      dc = await p.owner.ingest.candidate.get({ candidateId: dies });
      await p.owner.ingest.answer.set({ candidateId: dies, questionCode: q.code, subject: q.subject, answer: "kg/ft", expectSeq: dc.serverSeq });
    }
    await pump(p.owner, dies);
    expect((await rowsOf(p.owner, dies)).map((r) => r.state)).toEqual(["ready_create"]);
    // The die sheet finished with the section: the order book is checked again (rule 2).
    await pump(p.owner, book);
    expect((await rowsOf(p.owner, book)).map((r) => r.state)).toEqual(["ready_create", "ready_create"]);
    expect(await tryApprove(p.owner, dies)).toBe("approved");
    expect(await tryApprove(p.owner, book)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await countOf(env, "die", p.companyId)).toBe(1);
    expect(await countOf(env, "sales_order_line", p.companyId)).toBe(2);
  });
});

describe("S3-7: an aliases sheet may use a customer a customers sheet of the same upload adds", () => {
  for (const first of ["customers", "aliases"] as const) {
    test(`the ${first} sheet checked first: one customer and one alias are written`, async () => {
      const p = await plant(env);
      await learnLayout(env, p.companyId, p.users.owner.id, layout("customers", ["Party name", "City"], [{ field: "name", steps: trim }, { field: "city", steps: trim }], ["name"]), "Parties");
      await learnLayout(
        env,
        p.companyId,
        p.users.owner.id,
        layout("customer_aliases", ["Party", "Also called"], [{ field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] }, { field: "alias", steps: trim }], ["alias"]),
        "Aliases",
      );
      const { candidates } = await upload(p.owner, [
        { name: "Parties", headers: ["Party name", "City"], rows: [["Nova Metals", "Rajkot"]] },
        { name: "Aliases", headers: ["Party", "Also called"], rows: [["Nova Metals", "Nova"]] },
      ]);
      const [cu, al] = [candidates[0]!.id, candidates[1]!.id];
      if (first === "customers") {
        await pump(p.owner, cu);
        await pump(p.owner, al);
      } else {
        await pump(p.owner, al);
        // Not found yet, and approve says why it must wait.
        expect((await rowsOf(p.owner, al)).map((r) => r.reasons)).toEqual([["not_found:customer"]]);
        await pump(p.owner, cu);
        // The customers sheet finished with Nova Metals: the aliases sheet is checked again (rule 2).
        await pump(p.owner, al);
      }
      expect((await rowsOf(p.owner, al)).map((r) => r.state)).toEqual(["ready_create"]);
      expect(await tryApprove(p.owner, cu)).toBe("approved");
      expect(await tryApprove(p.owner, al)).toBe("approved");
      expect((await mergeOnce(p.owner)).state).toBe("done");
      expect(await countOf(env, "customer", p.companyId)).toBe(1);
      expect(await countOf(env, "customer_alias", p.companyId)).toBe(1);
    });
  }

  test("approve refuses an aliases sheet whose refused customer a customers sheet now adds, or still checks", async () => {
    const p = await plant(env);
    await learnLayout(env, p.companyId, p.users.owner.id, layout("customers", ["Party name", "City"], [{ field: "name", steps: trim }, { field: "city", steps: trim }], ["name"]), "Parties");
    await learnLayout(
      env,
      p.companyId,
      p.users.owner.id,
      layout("customer_aliases", ["Party", "Also called"], [{ field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] }, { field: "alias", steps: trim }], ["alias"]),
      "Aliases",
    );
    const { candidates } = await upload(p.owner, [
      { name: "Aliases", headers: ["Party", "Also called"], rows: [["Nova Metals", "Nova"]] },
      { name: "Parties", headers: ["Party name", "City"], rows: [["Nova Metals", "Rajkot"]] },
    ]);
    const [al] = [candidates[0]!.id];
    await pump(p.owner, al);
    // The customers sheet is not checked yet: its names are not known, so the aliases sheet waits.
    // Rule 4.3: the words name the file and sheet the aliases sheet waits on.
    expect(await tryApprove(p.owner, al)).toBe("REFUSED: book.xlsx (Parties) of this upload is still being checked. Finish it first, then check this sheet again.");
  });
});
