/**
 * Server round 7 (PORTAL-RULES-3 sections 8 and 9, the web lane's findings):
 * - item 2: what the reader said about each table (blank rows crossed, skipped lines, sections) is
 *   kept with the block and shown with the candidate and the file. Display facts only.
 * - item 3: a clean sheet is not asked. No layout fits, the reader's guess is one row, nothing is
 *   above it in the preview, and it resembles no layout: kept by the reader, on to "needs a layout".
 * - item 4: before any row of the file is written, a table can be put again with a new pick, and the
 *   file's tables can be sent again with a new count (join, start a new table, drop a repeat).
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, mergeOnce, plant, pump, putRowsAs, trim, type Caller } from "./ingest-portal-helpers";

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
const ROW = ["Acme Traders", "41", "PO-9", "31/10/2025", "R", "5100", "3658", "100"];
const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

async function setup() {
  const p = await plant(env);
  await p.owner.customer.create({ name: "Acme Traders" });
  await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
  await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", BOOK, FIELDS, ["customer", "oldOrderNo", "orderDate"]), "Book");
  return p;
}

const begin = async (as: Caller, fileName = "book.xlsx") => (await as.ingest.artifact.begin({ sha256: sha(), fileName, sizeBytes: 1000, contentType: null, kind: "sheet" })).artifactId;
const book = (o: Record<string, unknown> = {}) => ({
  ordinal: 0,
  sheetName: "A",
  title: null,
  headerRow: 0,
  headerRows: 1,
  rowCount: 1,
  sample: [ROW],
  preview: [
    { row: 0, cells: BOOK },
    { row: 1, cells: ROW },
  ],
  ...o,
});

describe("item 2: the reader's facts about each table are kept and shown", () => {
  test("gaps, the skipped lines (with their true count) and the sections come back on the candidate and the file", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const long = "x".repeat(300);
    const out = await p.owner.ingest.artifact.putBlocks({
      artifactId: id,
      blocks: [
        book({
          gaps: 3,
          warnings: [
            { code: "skipped_title", row: 7, text: "December" },
            { code: "skipped_repeat_header", row: 12, text: BOOK.join(" ") },
            { code: "after_last_row", row: 30, text: long },
          ],
          warningsTotal: 250,
          sections: [{ row: 7, text: "December" }],
        }),
      ],
    });
    expect(out.header[0]).toMatchObject({ answer: "keep" });
    const facts = {
      gaps: 3,
      warnings: [
        { code: "skipped_title", row: 7, text: "December" },
        { code: "skipped_repeat_header", row: 12, text: BOOK.join(" ") },
        { code: "after_last_row", row: 30, text: "x".repeat(200) },
      ],
      warningsTotal: 250,
      sections: [{ row: 7, text: "December" }],
      sectionsTotal: 1,
    };
    const c = await p.owner.ingest.candidate.get({ candidateId: out.candidates[0]!.id });
    expect(c.block).toMatchObject(facts);
    const file = await p.owner.ingest.artifact.get({ artifactId: id });
    expect(file.blocks[0]).toMatchObject(facts);
  });

  test("a table with none of them shows zero and empty lists; more than 200 listed lines is refused", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const out = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [book()] });
    expect((await p.owner.ingest.candidate.get({ candidateId: out.candidates[0]!.id })).block).toMatchObject({ gaps: 0, warnings: [], warningsTotal: 0, sections: [], sectionsTotal: 0 });
    const id2 = await begin(p.owner, "two.xlsx");
    const many = Array.from({ length: 201 }, (_, i) => ({ code: "skipped_title" as const, row: i + 2, text: "Month" }));
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId: id2, blocks: [book({ warnings: many })] })).rejects.toThrow();
  });
});

describe("item 3: a clean sheet no layout fits is kept, not asked", () => {
  const ODD = ["Kachha maal", "Vazan", "Rate"];
  const DATA = [
    ["Om Metals", "120", "55"],
    ["Kamal Bros", "80", "54"],
  ];
  const plain = (o: Record<string, unknown> = {}) => ({
    ordinal: 0,
    sheetName: "Scrap",
    title: null,
    headerRow: 0,
    headerRows: 1,
    rowCount: 2,
    sample: DATA,
    preview: [{ row: 0, cells: ODD }, ...DATA.map((cells, i) => ({ row: i + 1, cells }))],
    ...o,
  });

  test("a plain unknown sheet is kept by the reader with no question and reaches needs a layout", async () => {
    const p = await setup();
    const id = await begin(p.owner, "scrap.xlsx");
    const out = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [plain()] });
    expect(out.header[0]).toMatchObject({ answer: "keep", by: "reader" });
    await putRowsAs(p.owner, { blockId: out.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: DATA });
    await p.owner.ingest.artifact.complete({ artifactId: id });
    const c = await p.owner.ingest.candidate.get({ candidateId: out.candidates[0]!.id });
    expect(c.state).toBe("needs_shape");
    expect(c.block.headers).toEqual(ODD);
  });

  test("blank rows above the header in the preview still count as nothing above it", async () => {
    const p = await setup();
    const id = await begin(p.owner, "scrap.xlsx");
    const out = await p.owner.ingest.artifact.putBlocks({
      artifactId: id,
      blocks: [plain({ headerRow: 2, preview: [{ row: 0, cells: ["", "", ""] }, { row: 2, cells: ODD }, ...DATA.map((cells, i) => ({ row: i + 3, cells }))] })],
    });
    expect(out.header[0]).toMatchObject({ answer: "keep", by: "reader" });
  });

  test("a letterhead above the guessed header asks", async () => {
    const p = await setup();
    const id = await begin(p.owner, "scrap.xlsx");
    const out = await p.owner.ingest.artifact.putBlocks({
      artifactId: id,
      blocks: [plain({ headerRow: 1, preview: [{ row: 0, cells: ["Fourcubes Extrusions", "Rajkot", ""] }, { row: 1, cells: ODD }, ...DATA.map((cells, i) => ({ row: i + 2, cells }))] })],
    });
    expect(out.header[0]).toMatchObject({ answer: "ask", guess: { headerRow: 1, headerRows: 1 } });
    expect(out.blocks).toEqual([]);
  });

  test("a guess of two header rows asks", async () => {
    const p = await setup();
    const id = await begin(p.owner, "scrap.xlsx");
    const out = await p.owner.ingest.artifact.putBlocks({
      artifactId: id,
      blocks: [plain({ headerRows: 2, preview: [{ row: 0, cells: ODD }, { row: 1, cells: ["", "kg", "Rs/kg"] }, ...DATA.map((cells, i) => ({ row: i + 2, cells }))] })],
    });
    expect(out.header[0]).toMatchObject({ answer: "ask" });
  });

  test("a near fit asks with resembles", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const near = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Bakee (kg)"];
    const out = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [book({ preview: [{ row: 0, cells: near }, { row: 1, cells: ROW }] })] });
    expect(out.header[0]).toMatchObject({ answer: "ask", resembles: { name: "Book", fit: "near" } });
  });

  test("an exact fit is kept as before", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const out = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [book()] });
    expect(out.header[0]).toMatchObject({ answer: "keep", by: "fit" });
  });
});

describe("item 4: a table is put again with a new pick while no row of the file is written", () => {
  const seqOf = async (as: Caller, candidateId: string) => (await as.ingest.candidate.get({ candidateId })).serverSeq;
  const blocksOf = async (artifactId: string) =>
    (
      await env.d1
        .prepare("select ordinal, row_count as rows, rows_put as put, header_by as by, header_pick as pick from ingest_block where artifact_id = ? order by ordinal")
        .bind(artifactId)
        .all<{ ordinal: number; rows: number; put: number; by: string; pick: string | null }>()
    ).results;
  const reputAudits = async (companyId: string) =>
    Number((await env.d1.prepare("select count(*) as n from audit_log where company_id = ? and action = 'ingest.block.reput'").bind(companyId).first<{ n: number }>())!.n);

  test("join an all-text table: the saved upper table is read again with lastDataRow and skipRows, the lower one is dropped", async () => {
    const p = await setup();
    const id = await begin(p.owner, "parties.xlsx");
    const NAMES = ["Name", "Phone", "Email", "GSTIN", "Notes"];
    const r1 = ["Om Metals", "98250 11111", "om@example.in", "", ""];
    const r2 = ["Kamal Bros", "98250 22222", "kb@example.in", "", ""];
    const r3 = ["Shree Alu", "98250 33333", "sa@example.in", "", ""];
    const upper = { ordinal: 0, sheetName: "P", title: null, headerRow: 0, headerRows: 1, rowCount: 2, sample: [r1, r2], preview: [{ row: 0, cells: NAMES }, { row: 1, cells: r1 }, { row: 2, cells: r2 }] };
    const lower = {
      ordinal: 1,
      sheetName: "P",
      title: "December",
      headerRow: 5,
      headerRows: 1,
      rowCount: 0,
      sample: [],
      preview: [{ row: 4, cells: ["December", "", "", "", ""] }, { row: 5, cells: r3 }],
      follows: { ordinal: 0, gapRows: 1, continues: true },
    };
    const first = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [upper, lower] });
    expect(first.header.map((h) => h.answer)).toEqual(["keep", "ask"]);
    // "It continues the table above": the upper table again, to row 5, with the title row left out.
    const blank = ["", "", "", "", ""];
    const joined = {
      ...upper,
      rowCount: 4,
      sample: [r1, r2, blank, r3],
      preview: [{ row: 0, cells: NAMES }, { row: 1, cells: r1 }, { row: 2, cells: r2 }, { row: 4, cells: ["December", "", "", "", ""] }, { row: 5, cells: r3 }],
      hint: { headerRow: 0, headerRows: 1 as const, lastDataRow: 5, skipRows: [4] },
    };
    const again = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [joined] });
    expect(again.header).toEqual([{ ordinal: 0, answer: "keep", by: "person", blockId: again.blocks[0]!.blockId }]);
    expect(again.blocks).toHaveLength(1);
    expect(again.candidates).toHaveLength(1);
    const [b] = await blocksOf(id);
    expect(b).toMatchObject({ ordinal: 0, rows: 4, by: "person" });
    expect(JSON.parse(b!.pick!)).toMatchObject({ by: p.users.owner.id, lastDataRow: 5, skipRows: [4] });
    await putRowsAs(p.owner, { blockId: again.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: [r1, r2, blank, r3] });
    await p.owner.ingest.artifact.complete({ artifactId: id });
    expect((await p.owner.ingest.artifact.get({ artifactId: id })).readState).toBe("read");
    expect(await reputAudits(p.companyId)).toBe(1);
  });

  test("start a new table at a section: the read table ends before it, a new table is added; the old rows are reset", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const R2 = ["Acme Traders", "42", "PO-10", "31/10/2025", "R", "5100", "3658", "120"];
    const R3 = ["Acme Traders", "43", "PO-11", "01/12/2025", "R", "5100", "3658", "90"];
    const whole = book({
      rowCount: 5,
      sample: [ROW, R2, ["December", "", "", "", "", "", "", ""], BOOK, R3],
      preview: [{ row: 0, cells: BOOK }, { row: 1, cells: ROW }, { row: 2, cells: R2 }, { row: 3, cells: ["December", "", "", "", "", "", "", ""] }, { row: 4, cells: BOOK }, { row: 5, cells: R3 }],
      sections: [{ row: 3, text: "December" }],
    });
    const first = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [whole] });
    expect(first.header[0]).toMatchObject({ answer: "keep", by: "fit" });
    await putRowsAs(p.owner, { blockId: first.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: whole.sample });
    await p.owner.ingest.artifact.complete({ artifactId: id });
    const oldCandidate = first.candidates[0]!.id;
    // "Start a new table here": the upper table to row 2 (the row before the section), and the rest.
    const upper = book({ rowCount: 2, sample: [ROW, R2], preview: [{ row: 0, cells: BOOK }, { row: 1, cells: ROW }, { row: 2, cells: R2 }], hint: { headerRow: 0, headerRows: 1, lastDataRow: 2, skipRows: [] } });
    const lower = book({ ordinal: 1, title: "December", headerRow: 4, rowCount: 1, sample: [R3], preview: [{ row: 3, cells: ["December", "", "", "", "", "", "", ""] }, { row: 4, cells: BOOK }, { row: 5, cells: R3 }] });
    const again = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [upper, lower] });
    expect(again.header.map((h) => [h.ordinal, h.answer, "by" in h ? h.by : null])).toEqual([
      [0, "keep", "person"],
      [1, "keep", "fit"],
    ]);
    expect(again.candidates.map((c) => c.id)).not.toContain(oldCandidate);
    expect((await blocksOf(id)).map((b) => [b.ordinal, b.rows, b.put])).toEqual([
      [0, 2, 0],
      [1, 1, 0],
    ]);
    expect((await env.d1.prepare("select count(*) as n from ingest_staged_row where candidate_id = ?").bind(oldCandidate).first<{ n: number }>())!.n).toBe(0);
    await putRowsAs(p.owner, { blockId: again.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: [ROW, R2] });
    await putRowsAs(p.owner, { blockId: again.blocks[1]!.blockId, headerRow: 4, fromIndex: 0, expectRowsPut: 0, rows: [R3] });
    await p.owner.ingest.artifact.complete({ artifactId: id });
    expect((await p.owner.ingest.artifact.get({ artifactId: id })).readState).toBe("read");
  });

  test("drop a repeated header: two saved tables become one; the unchanged table keeps its rows when another is added", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const R2 = ["Acme Traders", "42", "PO-10", "31/10/2025", "R", "5100", "3658", "120"];
    const upper = book();
    const repeat = book({ ordinal: 1, headerRow: 3, sample: [R2], preview: [{ row: 3, cells: BOOK }, { row: 4, cells: R2 }], follows: { ordinal: 0, gapRows: 1, continues: false } });
    const first = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [upper, repeat] });
    // Both fit the layout exactly, so both are kept; the person still joins them before any row is written.
    expect(first.header.map((h) => h.answer)).toEqual(["keep", "keep"]);
    // The lower table repeats the header: the person joins it to the table above.
    const joined = book({
      rowCount: 4,
      sample: [ROW, Array(8).fill(""), Array(8).fill(""), R2],
      preview: [{ row: 0, cells: BOOK }, { row: 1, cells: ROW }, { row: 3, cells: BOOK }, { row: 4, cells: R2 }],
      hint: { headerRow: 0, headerRows: 1, lastDataRow: 4, skipRows: [3] },
    });
    const again = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [joined] });
    expect(again.header).toEqual([{ ordinal: 0, answer: "keep", by: "person", blockId: again.blocks[0]!.blockId }]);
    expect(await blocksOf(id)).toHaveLength(1);
    // A replay of the same call changes nothing.
    const replay = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [joined] });
    expect(replay.blocks[0]!.blockId).toBe(again.blocks[0]!.blockId);
    await putRowsAs(p.owner, { blockId: again.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: joined.sample });
    // A table added below later keeps the saved table and its rows.
    const extra = book({ ordinal: 1, sheetName: "B", sample: [R2], preview: [{ row: 0, cells: BOOK }, { row: 1, cells: R2 }] });
    const more = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [joined, extra] });
    expect(more.blocks[0]!.blockId).toBe(again.blocks[0]!.blockId);
    expect((await blocksOf(id)).map((b) => [b.ordinal, b.put])).toEqual([
      [0, 4],
      [1, 0],
    ]);
  });

  test("once a row of the file is written, putting a table again is refused", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const first = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [book()] });
    await putRowsAs(p.owner, { blockId: first.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: [ROW] });
    await p.owner.ingest.artifact.complete({ artifactId: id });
    const cid = first.candidates[0]!.id;
    await pump(p.owner, cid);
    await p.owner.ingest.candidate.approve({ candidateId: cid, expectSeq: await seqOf(p.owner, cid) });
    expect((await mergeOnce(p.owner)).state).toBe("done");
    await expect(
      p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [book({ hint: { headerRow: 0, headerRows: 1, lastDataRow: 1, skipRows: [] } })] }),
    ).rejects.toThrow("Rows of this sheet are already written. Its columns cannot change now.");
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [book(), book({ ordinal: 1, sheetName: "B" })] })).rejects.toThrow(
      "Rows of this sheet are already written. Its columns cannot change now.",
    );
  });
});
