/**
 * Server round 7 (PORTAL-RULES-3 sections 8 and 9, the web lane's findings):
 * - item 2: what the reader said about each table (blank rows crossed, skipped lines, sections) is
 *   kept with the block and shown with the candidate and the file. Display facts only.
 * - item 3: a clean sheet is not asked. No layout fits, the reader's guess is one row, nothing is
 *   above it in the preview, and it resembles no layout: kept by the reader, on to "needs a layout".
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, plant, putRowsAs, trim, type Caller } from "./ingest-portal-helpers";

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
