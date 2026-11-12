/**
 * Order identity (PORTAL-RULES-3 section 1), driven through the real ingest procedures on real D1:
 * one old order is one sales order whatever its PO cells say; two POs in one order is one question;
 * the same old order in two sheets or two uploads is never written twice; a sheet with no order
 * number groups by customer and PO; a row with neither is its own order; and an order number that
 * repeats in another financial year is another order. No model and no network.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { putBlocksPicked, putRowsAs } from "./ingest-portal-helpers";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

import { fingerprint, type Recipe } from "@orrn/ingest";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

type Caller = ReturnType<TestEnv["caller"]>;
type Sheet = { headers: string[]; rows: string[][]; name?: string };

const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

async function plant() {
  const { companyId, users } = await env.seedCompany();
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, as, owner: as("owner") };
}

async function upload(as: Caller, sheets: Sheet[], fileName = "book.xlsx") {
  const begin = await as.ingest.artifact.begin({ sha256: sha(), fileName, sizeBytes: 1000, contentType: null, kind: "sheet" });
  const put = await putBlocksPicked(as, {
    artifactId: begin.artifactId,
    blocks: sheets.map((s, ordinal) => ({
      ordinal,
      sheetName: s.name ?? `Sheet${ordinal + 1}`,
      title: null,
      headerRow: 0,
      headerRows: 1,
      headers: s.headers,
      rowCount: s.rows.length,
      sample: s.rows.slice(0, 200),
    })),
  });
  for (const [i, s] of sheets.entries()) {
    const block = put.blocks.find((b) => b.ordinal === i)!;
    if (s.rows.length > 0) await putRowsAs(as, { blockId: block.blockId, fromIndex: 0, expectRowsPut: 0, rows: s.rows });
  }
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  return { artifactId: begin.artifactId, candidates: put.candidates.sort((a, b) => a.blockOrdinal - b.blockOrdinal) };
}

async function pump(as: Caller, candidateId: string) {
  let cursor = (await as.ingest.candidate.get({ candidateId })).dryCursor;
  for (let i = 0; i < 50; i += 1) {
    const out = await as.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    if (out.done) return out;
    cursor = out.cursor;
  }
  throw new Error("dry run did not finish");
}

async function learnLayout(companyId: string, createdBy: string, recipe: Recipe, name = "Learned") {
  const { ingestHole, ingestHoleVersion } = await import("@orrn/db/schema/ingest");
  const holeId = `hole_${randomUUID()}`;
  await env.db.insert(ingestHole).values({ id: holeId, companyId, target: recipe.target, name, currentVersion: 1, state: "active", createdBy });
  await env.db.insert(ingestHoleVersion).values({
    id: `hv_${randomUUID()}`,
    companyId,
    holeId,
    version: 1,
    headerKey: recipe.match.headerKey,
    recipe: recipe as never,
    madeBy: "person",
    state: "approved",
    createdBy,
  });
}

const trim = [{ op: "trim" as const }];

function layout(headers: string[], fields: { field: string; steps: Recipe["fields"][number]["steps"] }[]): Recipe {
  const fp = fingerprint({ headers, rows: [] });
  return {
    schemaVersion: 1,
    target: "orders",
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: fp.headerKey, headers: fp.normalized },
    fields: fields.map((f, i) => ({ field: f.field, source: { kind: "columns" as const, cols: [{ col: i, header: headers[i]! }] }, steps: f.steps })),
    filters: [],
    keys: ["customer", "oldOrderNo", "orderDate"],
    onExisting: "ask",
    unclear: [],
  } as Recipe;
}

const LINE_FIELDS = [
  { field: "series", steps: [{ op: "trim" as const }, { op: "case" as const, to: "upper" as const }] },
  { field: "sectionCode", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "section_by_code" as const }] },
  { field: "cutLength", steps: [{ op: "number" as const, kind: "length" as const, unit: "mm" }] },
  { field: "bakiKg", steps: [{ op: "number" as const, kind: "mass" as const, unit: "kg" }] },
];
const party = { field: "customer", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "customer_by_name" as const }] };
const date = { field: "orderDate", steps: [{ op: "date" as const, format: "dmy" as const }] };

/** An order book with an old order number column. */
const BOOK = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
const bookLayout = () => layout(BOOK, [party, { field: "oldOrderNo", steps: trim }, { field: "poNumber", steps: trim }, date, ...LINE_FIELDS]);
/** An order book with no order number column. */
const PO_BOOK = ["Party", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
const poBookLayout = () => layout(PO_BOOK, [party, { field: "poNumber", steps: trim }, date, ...LINE_FIELDS]);

async function setup() {
  const p = await plant();
  await p.owner.customer.create({ name: "Acme Traders" });
  await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
  await env.seedDie(p.companyId, { series: "R", sectionCode: "5101" });
  await env.seedDie(p.companyId, { series: "R", sectionCode: "5102" });
  await learnLayout(p.companyId, p.users.owner.id, bookLayout(), "Book");
  await learnLayout(p.companyId, p.users.owner.id, poBookLayout(), "PO book");
  return p;
}

async function rowsOf(as: Caller, candidateId: string) {
  return (await as.ingest.rows.list({ candidateId, limit: 100 })).items;
}

async function approve(as: Caller, candidateId: string) {
  const c = await as.ingest.candidate.get({ candidateId });
  return as.ingest.candidate.approve({ candidateId, expectSeq: c.serverSeq });
}

async function mergeOnce(as: Caller) {
  const { runId } = await as.ingest.merge.start();
  let cursor = 0;
  for (let i = 0; i < 80; i += 1) {
    const s = await as.ingest.merge.step({ runId, expectCursor: cursor });
    cursor = s.cursor;
    if (s.state !== "planning" && s.state !== "running") return s;
  }
  throw new Error("The merge did not finish");
}

async function orders(companyId: string) {
  const r = await env.d1
    .prepare("select o.id, o.po_number as po, o.note, (select count(*) from sales_order_line l where l.sales_order_id = o.id) as lines from sales_order o where o.company_id = ? order by o.created_at, o.id")
    .bind(companyId)
    .all<{ id: string; po: string | null; note: string | null; lines: number }>();
  return r.results.map((o) => ({ po: o.po, note: o.note, lines: Number(o.lines) }));
}

async function decide(as: Caller, candidateId: string, rowIds: string[], decision: "skip" | "keep_file") {
  const c = await as.ingest.candidate.get({ candidateId });
  await as.ingest.rows.decide({ candidateId, rowIds, decision, expectSeq: c.serverSeq });
  await pump(as, candidateId);
}

describe("one old order is one sales order (M-new-2)", () => {
  test("an order whose PO is on some rows only merges as one order with that PO and every line", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [
      {
        headers: BOOK,
        rows: [
          ["Acme Traders", "41", "PO-9", "31/10/2025", "R", "5100", "3658", "300"],
          ["Acme Traders", "041", "", "31/10/2025", "R", "5101", "3658", "200"],
          ["Acme Traders", " 41 ", "", "31/10/2025", "R", "5102", "3658", "100"],
        ],
      },
    ]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create"]);
    expect((await approve(p.owner, id)).state).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-9", note: "Old order no. 41", lines: 3 }]);
  });

  test("two different POs in one order is one question; the answer picks the PO and the order merges whole", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [
      {
        headers: BOOK,
        rows: [
          ["Acme Traders", "41", "PO-9", "31/10/2025", "R", "5100", "3658", "300"],
          ["Acme Traders", "41", "PO-10", "31/10/2025", "R", "5101", "3658", "200"],
          ["Acme Traders", "41", "", "31/10/2025", "R", "5102", "3658", "100"],
        ],
      },
    ]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    const asked = c.questions.filter((q) => q.code === "order_po");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ open: true, params: { order: "41", pos: "PO-9, PO-10", count: 3 } });
    expect(c.openQuestions).toBe(1);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ambiguous", "ambiguous", "ambiguous"]);
    await expect(approve(p.owner, id)).rejects.toThrow("Answer every question first");
    await expect(
      p.owner.ingest.answer.set({ candidateId: id, questionCode: "order_po", subject: asked[0]!.subject, answer: { po: "PO-11" }, expectSeq: c.serverSeq }),
    ).rejects.toThrow("That answer does not fit the question");
    await p.owner.ingest.answer.set({ candidateId: id, questionCode: "order_po", subject: asked[0]!.subject, answer: { po: "PO-10" }, expectSeq: c.serverSeq });
    await pump(p.owner, id);
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.openQuestions).toBe(0);
    expect((await approve(p.owner, id)).state).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: "PO-10", note: "Old order no. 41", lines: 3 }]);
  });

  test("the answer 'skip' leaves the whole order out", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [
      {
        headers: BOOK,
        rows: [
          ["Acme Traders", "41", "PO-9", "31/10/2025", "R", "5100", "3658", "300"],
          ["Acme Traders", "41", "PO-10", "31/10/2025", "R", "5101", "3658", "200"],
          ["Acme Traders", "42", "", "31/10/2025", "R", "5102", "3658", "100"],
        ],
      },
    ]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    const c = await p.owner.ingest.candidate.get({ candidateId: id });
    const q = c.questions.find((x) => x.code === "order_po")!;
    await p.owner.ingest.answer.set({ candidateId: id, questionCode: "order_po", subject: q.subject, answer: "skip", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["skipped", "skipped", "ready_create"]);
    expect((await approve(p.owner, id)).state).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([{ po: null, note: "Old order no. 42", lines: 1 }]);
  });
});

describe("the same old order in two files is never written twice (M-new-3)", () => {
  const sheetA = (): Sheet => ({
    name: "Book A",
    headers: BOOK,
    rows: [
      ["Acme Traders", "41", "", "31/10/2025", "R", "5100", "3658", "300"],
      ["Acme Traders", "41", "", "31/10/2025", "R", "5101", "3658", "200"],
      ["Acme Traders", "50", "", "31/10/2025", "R", "5100", "3658", "100"],
    ],
  });
  const sheetB = (): Sheet => ({ name: "Book B", headers: BOOK, rows: [["Acme Traders", "41", "", "31/10/2025", "R", "5102", "3658", "100"]] });

  test("two sheets of one upload: the dry run marks both and names the other sheet; skip in one, keep in the other, one order", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [sheetA(), sheetB()], "two-sheets.xlsx");
    const [a, b] = [candidates[0]!.id, candidates[1]!.id];
    await pump(p.owner, a);
    await pump(p.owner, b);
    const ra = await rowsOf(p.owner, a);
    const rb = await rowsOf(p.owner, b);
    expect(ra.map((r) => r.state)).toEqual(["conflict", "conflict", "ready_create"]);
    expect(rb.map((r) => r.state)).toEqual(["conflict"]);
    expect(ra[0]!.reasons).toContain("order_in_other_file:order");
    expect((rb[0]!.values as Record<string, unknown>)._otherFile).toMatchObject({ candidateId: a, fileName: "two-sheets.xlsx", sheetName: "Book A" });
    expect((ra[0]!.values as Record<string, unknown>)._otherFile).toMatchObject({ candidateId: b, sheetName: "Book B" });
    await expect(approve(p.owner, a)).rejects.toThrow("Choose for 2 rows first");
    // The person leaves old order 41 out of sheet B and keeps sheet A's.
    await decide(p.owner, b, [rb[0]!.id], "skip");
    await decide(p.owner, a, [ra[0]!.id, ra[1]!.id], "keep_file");
    expect((await rowsOf(p.owner, a)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create"]);
    expect((await approve(p.owner, a)).state).toBe("approved");
    expect((await approve(p.owner, b)).state).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect((await orders(p.companyId)).filter((o) => o.note === "Old order no. 41")).toEqual([{ po: null, note: "Old order no. 41", lines: 2 }]);
  });

  test("two uploads kept on both sides: the planner holds the later one; after the first merges, its dry run sees the live order", async () => {
    const p = await setup();
    const one = await upload(p.owner, [sheetA()], "october.xlsx");
    const two = await upload(p.owner, [sheetB()], "october-copy.xlsx");
    const [a, b] = [one.candidates[0]!.id, two.candidates[0]!.id];
    await pump(p.owner, a);
    await pump(p.owner, b);
    const rb = await rowsOf(p.owner, b);
    expect((rb[0]!.values as Record<string, unknown>)._otherFile).toMatchObject({ candidateId: a, fileName: "october.xlsx" });
    // Kept on both sides: the planner is the last check.
    await decide(p.owner, b, [rb[0]!.id], "keep_file");
    const ra = await rowsOf(p.owner, a);
    await decide(p.owner, a, ra.filter((r) => r.state === "conflict").map((r) => r.id), "keep_file");
    expect((await approve(p.owner, a)).state).toBe("approved");
    expect((await approve(p.owner, b)).state).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done_with_holds");
    // The planner held B (the audit keeps its words); item 3 (round 5): once A merged, B checks
    // again by itself, with no release.
    const held = await env.d1
      .prepare("select json_extract(meta, '$.detail') as d from audit_log where company_id = ? and action = 'ingest.candidate.hold' and subject_id = ?")
      .bind(p.companyId, b)
      .first<{ d: string }>();
    expect(held?.d).toContain("Old order 41 is also in october.xlsx");
    expect((await p.owner.ingest.candidate.get({ candidateId: b })).state).toBe("processing");
    expect((await orders(p.companyId)).filter((o) => o.note === "Old order no. 41")).toEqual([{ po: null, note: "Old order no. 41", lines: 2 }]);
    // The order is live now, so the line it lacks is a conflict, never a second order.
    await pump(p.owner, b);
    const again = await rowsOf(p.owner, b);
    expect(again[0]!.state).toBe("conflict");
    expect(again[0]!.reasons).toContain("order_line_new");
    expect(again[0]!.reasons).not.toContain("order_in_other_file:order");
  });

  test("an orders sheet over the planning ceiling is held with words that say the limit and what works", async () => {
    const { ORDERS_TOO_BIG } = await import("../src/lib/ingest/merge/planner");
    expect(ORDERS_TOO_BIG).not.toMatch(/Split the file and import each part\.$/);
    expect(ORDERS_TOO_BIG).toContain("5000");
    expect(ORDERS_TOO_BIG).toContain("every row of one order");
  });
});

describe("a sheet with no order number", () => {
  test("rows group by customer and PO; a row with neither is its own order, and the summary says so", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [
      {
        headers: PO_BOOK,
        rows: [
          ["Acme Traders", "PO-1", "31/10/2025", "R", "5100", "3658", "300"],
          ["Acme Traders", "po-1 ", "31/10/2025", "R", "5101", "3658", "200"],
          ["Acme Traders", "PO-2", "31/10/2025", "R", "5100", "3658", "100"],
          ["Acme Traders", "", "31/10/2025", "R", "5100", "3658", "100"],
          ["Acme Traders", "", "31/10/2025", "R", "5101", "3658", "100"],
        ],
      },
    ]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    const c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.rowsOwnOrder).toBe(2);
    expect((await approve(p.owner, id)).state).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    const made = await orders(p.companyId);
    expect(made.map((o) => o.lines).sort()).toEqual([1, 1, 1, 2]);
    expect(made.filter((o) => o.po === null)).toHaveLength(2);
  });
});

describe("financial years", () => {
  test("the same order number in another financial year is another order, in the file and against live orders", async () => {
    const p = await setup();
    const first = await upload(p.owner, [
      {
        headers: BOOK,
        rows: [
          ["Acme Traders", "7", "", "15/03/2025", "R", "5100", "3658", "300"],
          ["Acme Traders", "7", "", "10/05/2025", "R", "5100", "3658", "300"],
          ["Acme Traders", "7", "", "20/05/2025", "R", "5101", "3658", "300"],
        ],
      },
    ]);
    await pump(p.owner, first.candidates[0]!.id);
    await approve(p.owner, first.candidates[0]!.id);
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect((await orders(p.companyId)).map((o) => o.lines).sort()).toEqual([1, 2]);
    // A later file: old order 7 of 2025-26 is the live one; old order 7 of 2026-27 is new.
    const second = await upload(p.owner, [
      {
        headers: BOOK,
        rows: [
          ["Acme Traders", "7", "", "21/05/2025", "R", "5101", "3658", "300"],
          ["Acme Traders", "7", "", "02/04/2026", "R", "5101", "3658", "300"],
        ],
      },
    ]);
    const id = second.candidates[0]!.id;
    await pump(p.owner, id);
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => [r.state, r.reasons?.includes("order_exists") ?? false])).toEqual([
      ["unchanged", true],
      ["ready_create", false],
    ]);
  });
});
