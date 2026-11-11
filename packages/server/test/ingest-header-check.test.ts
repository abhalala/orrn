/**
 * Rule 4.1 (PORTAL-RULES-3): the server decides which row holds the column names. `putBlocks` takes
 * each block's preview and the reader's guess, runs `chooseHeader` with the plant's approved layouts
 * and the built-in ones, and answers keep, reread or ask. Rows are taken only once a block's header
 * is settled. A person's pick is trusted and recorded.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, plant, trim, type Caller } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const BOOK = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
const bookLayout = () =>
  layout(
    "orders",
    BOOK,
    [
      { field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
      { field: "oldOrderNo", steps: trim },
      { field: "poNumber", steps: trim },
      { field: "orderDate", steps: [{ op: "date", format: "dmy" }] },
      { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
      { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
      { field: "cutLength", steps: [{ op: "number", kind: "length", unit: "mm" }] },
      { field: "bakiKg", steps: [{ op: "number", kind: "mass", unit: "kg" }] },
    ],
    ["customer", "oldOrderNo", "orderDate"],
  );
const DATA = [
  ["Acme Traders", "41", "PO-9", "31/10/2025", "R", "5100", "3658", "100"],
  ["Acme Traders", "42", "PO-10", "31/10/2025", "R", "5101", "3658", "120"],
  ["Kamal Bros", "43", "PO-11", "01/11/2025", "R", "5102", "4877", "90"],
];
/** A letterhead over the book: row 0 is the title, row 1 the column names, rows 2 on the data. */
const PREVIEW = [
  { row: 0, cells: ["Fourcubes Extrusions", "Rajkot", "Order book"] },
  { row: 1, cells: BOOK },
  ...DATA.map((cells, i) => ({ row: 2 + i, cells })),
];

async function begin(as: Caller) {
  return as.ingest.artifact.begin({ sha256: createHash("sha256").update(randomUUID()).digest("hex"), fileName: "book.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
}

const block = (over: Record<string, unknown>) => ({ ordinal: 0, sheetName: "Book", title: null, headers: BOOK, rowCount: DATA.length, sample: DATA, headerRow: 1, headerRows: 1, ...over });

async function headerByOf(blockId: string) {
  return (await env.d1.prepare("select header_by from ingest_block where id = ?").bind(blockId).first<{ header_by: string }>())?.header_by;
}

describe("rule 4.1: the server settles each block's header by fit, or a person picks it", () => {
  test("the guess fits the plant's layout: keep, the block is saved and its rows are taken", async () => {
    const p = await plant(env);
    await learnLayout(env, p.companyId, p.users.owner.id, bookLayout(), "Book");
    const { artifactId } = await begin(p.owner);
    const put = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: PREVIEW })] });
    expect(put.header).toEqual([{ ordinal: 0, answer: "keep", by: "fit", blockId: put.blocks[0]!.blockId }]);
    expect(await headerByOf(put.blocks[0]!.blockId)).toBe("fit");
    await p.owner.ingest.artifact.putRows({ blockId: put.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: DATA });
    await p.owner.ingest.artifact.complete({ artifactId });
    expect(put.candidates[0]!.state).toBe("processing");
  });

  test("the reader guessed the letterhead, the next row fits: reread with row 1; nothing is saved until the block comes again", async () => {
    const p = await plant(env);
    await learnLayout(env, p.companyId, p.users.owner.id, bookLayout(), "Book");
    const { artifactId } = await begin(p.owner);
    const first = await p.owner.ingest.artifact.putBlocks({
      artifactId,
      blocks: [block({ headerRow: 0, headers: PREVIEW[0]!.cells, sample: [BOOK, ...DATA], rowCount: DATA.length + 1, preview: PREVIEW })],
    });
    expect(first.header).toEqual([{ ordinal: 0, answer: "reread", headerRow: 1, headerRows: 1 }]);
    expect(first.blocks).toEqual([]);
    await expect(p.owner.ingest.artifact.complete({ artifactId })).rejects.toThrow("Pick the row with the column names for every table first");
    const again = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: PREVIEW })] });
    expect(again.header[0]).toMatchObject({ ordinal: 0, answer: "keep", by: "fit" });
    expect(again.blocks).toHaveLength(1);
  });

  test("nothing fits: ask with the guess and the candidate rows; the person's pick is trusted and recorded", async () => {
    const p = await plant(env);
    const { artifactId } = await begin(p.owner);
    const headers = ["Kachha maal", "Vazan", "Bhav"];
    const preview = [
      { row: 0, cells: ["Fourcubes Extrusions", "Rajkot", ""] },
      { row: 1, cells: headers },
      { row: 2, cells: ["Om Metals", "120", "210"] },
      { row: 3, cells: ["Kamal Bros", "90", "205"] },
    ];
    const blk = { ordinal: 0, sheetName: "Kharidi", title: null, headers: preview[0]!.cells, rowCount: 3, sample: preview.slice(1).map((r) => r.cells), headerRow: 0, headerRows: 1 };
    const asked = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [{ ...blk, preview }] });
    expect(asked.header[0]).toMatchObject({ ordinal: 0, answer: "ask", guess: { headerRow: 0, headerRows: 1 } });
    const ask = asked.header[0] as { candidates: { headerRow: number }[] };
    expect(ask.candidates.map((c) => c.headerRow)).toContain(1);
    expect(asked.blocks).toEqual([]);
    // The person picks row 1; the browser reads again with that hint and sends the block again.
    const picked = await p.owner.ingest.artifact.putBlocks({
      artifactId,
      blocks: [{ ...blk, headerRow: 1, headers, rowCount: 2, sample: preview.slice(2).map((r) => r.cells), preview, hint: { headerRow: 1, headerRows: 1 } }],
    });
    expect(picked.header[0]).toMatchObject({ ordinal: 0, answer: "keep", by: "person" });
    expect(await headerByOf(picked.blocks[0]!.blockId)).toBe("person");
    // A table with no known layout goes on to the bot or the mapping editor.
    expect(picked.candidates[0]!.state).toBe("needs_shape");
  });

  test("a pick that is not the header the block was read with is refused", async () => {
    const p = await plant(env);
    const { artifactId } = await begin(p.owner);
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: PREVIEW, hint: { headerRow: 0, headerRows: 1 } })] })).rejects.toThrow(
      "Read this table again with the row you picked, then send it",
    );
  });

  test("two blocks: the settled one is saved and keeps its id when the other comes back with a pick", async () => {
    const p = await plant(env);
    await learnLayout(env, p.companyId, p.users.owner.id, bookLayout(), "Book");
    const { artifactId } = await begin(p.owner);
    const odd = [
      { row: 0, cells: ["Kachha maal", "Vazan", "Bhav"] },
      { row: 1, cells: ["Om Metals", "120", "210"] },
    ];
    const other = { ordinal: 1, sheetName: "Kharidi", title: null, headers: odd[0]!.cells, rowCount: 1, sample: [odd[1]!.cells], headerRow: 0, headerRows: 1, preview: odd };
    const first = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: PREVIEW }), other] });
    expect(first.header.map((h) => h.answer)).toEqual(["keep", "ask"]);
    const kept = first.blocks[0]!.blockId;
    const second = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: PREVIEW }), { ...other, hint: { headerRow: 0, headerRows: 1 } }] });
    expect(second.header).toEqual([
      { ordinal: 0, answer: "keep", by: "fit", blockId: kept },
      { ordinal: 1, answer: "keep", by: "person", blockId: second.blocks[1]!.blockId },
    ]);
  });

  test("a block that was asked about comes back alone; the file cannot gain a sheet on the way", async () => {
    const p = await plant(env);
    const { artifactId } = await begin(p.owner);
    const odd = [
      { row: 0, cells: ["Kachha maal", "Vazan", "Bhav"] },
      { row: 1, cells: ["Om Metals", "120", "210"] },
    ];
    const blk = { ordinal: 0, sheetName: "Kharidi", title: null, headers: odd[0]!.cells, rowCount: 1, sample: [odd[1]!.cells], headerRow: 0, headerRows: 1, preview: odd };
    expect((await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [blk] })).header[0]!.answer).toBe("ask");
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [{ ...blk, hint: { headerRow: 0, headerRows: 1 } }, { ...blk, ordinal: 1 }] })).rejects.toThrow(/already saved/);
  });

  test("the old shape with no preview still works for one release, recorded as the reader's", async () => {
    const p = await plant(env);
    const { artifactId } = await begin(p.owner);
    const put = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({})] });
    expect(put.header).toEqual([{ ordinal: 0, answer: "keep", by: "reader", blockId: put.blocks[0]!.blockId }]);
    expect(await headerByOf(put.blocks[0]!.blockId)).toBe("reader");
  });

  test("the preview is at most 12 rows of at most 200 cells of at most 200 characters", async () => {
    const p = await plant(env);
    const { artifactId } = await begin(p.owner);
    const rows13 = Array.from({ length: 13 }, (_, i) => ({ row: i, cells: ["a", "b"] }));
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: rows13 })] })).rejects.toThrow();
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: [{ row: 0, cells: ["x".repeat(201)] }] })] })).rejects.toThrow();
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: [{ row: 0, cells: Array.from({ length: 201 }, () => "a") }] })] })).rejects.toThrow();
  });
});
