/**
 * Rule 4.1 (PORTAL-RULES-3): the server decides which row holds the column names. `putBlocks` takes
 * each block's preview and the reader's guess, runs `chooseHeader` with the plant's approved layouts
 * and the built-in ones, and answers keep, reread or ask. Rows are taken only once a block's header
 * is settled. A person's pick is trusted and recorded.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, plant, trim, type Caller, putRowsAs } from "./ingest-portal-helpers";

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

const block = (over: Record<string, unknown>) => ({ ordinal: 0, sheetName: "Book", title: null, headers: BOOK, rowCount: DATA.length, sample: DATA, headerRow: 1, headerRows: 1, preview: PREVIEW, ...over });

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
    await putRowsAs(p.owner, { blockId: put.blocks[0]!.blockId, headerRow: 1, headerRows: 1, fromIndex: 0, expectRowsPut: 0, rows: DATA });
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
    // Round 7 item 3: the reader guessed row 1, under the letterhead, so the server asks (a first-row
    // guess of a sheet no layout fits is kept by the reader with no question).
    const blk = { ordinal: 0, sheetName: "Kharidi", title: null, headers, rowCount: 2, sample: preview.slice(2).map((r) => r.cells), headerRow: 1, headerRows: 1 };
    const asked = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [{ ...blk, preview }] });
    expect(asked.header[0]).toMatchObject({ ordinal: 0, answer: "ask", guess: { headerRow: 1, headerRows: 1 } });
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
    // Round 7 item 3: a letterhead above the guess, so this table is asked.
    const odd = [
      { row: 0, cells: ["Fourcubes Extrusions", "Rajkot", ""] },
      { row: 1, cells: ["Kachha maal", "Vazan", "Bhav"] },
      { row: 2, cells: ["Om Metals", "120", "210"] },
    ];
    const other = { ordinal: 1, sheetName: "Kharidi", title: null, headers: odd[1]!.cells, rowCount: 1, sample: [odd[2]!.cells], headerRow: 1, headerRows: 1, preview: odd };
    const first = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: PREVIEW }), other] });
    expect(first.header.map((h) => h.answer)).toEqual(["keep", "ask"]);
    const kept = first.blocks[0]!.blockId;
    const second = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: PREVIEW }), { ...other, hint: { headerRow: 1, headerRows: 1 } }] });
    expect(second.header).toEqual([
      { ordinal: 0, answer: "keep", by: "fit", blockId: kept },
      { ordinal: 1, answer: "keep", by: "person", blockId: second.blocks[1]!.blockId },
    ]);
  });

  test("a block that was asked about comes back alone; the file cannot gain a sheet on the way", async () => {
    const p = await plant(env);
    const { artifactId } = await begin(p.owner);
    // Round 7 item 3: a letterhead above the guess, so this table is asked.
    const odd = [
      { row: 0, cells: ["Fourcubes Extrusions", "Rajkot", ""] },
      { row: 1, cells: ["Kachha maal", "Vazan", "Bhav"] },
      { row: 2, cells: ["Om Metals", "120", "210"] },
    ];
    const blk = { ordinal: 0, sheetName: "Kharidi", title: null, headers: odd[1]!.cells, rowCount: 1, sample: [odd[2]!.cells], headerRow: 1, headerRows: 1, preview: odd };
    expect((await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [blk] })).header[0]!.answer).toBe("ask");
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [{ ...blk, hint: { headerRow: 1, headerRows: 1 } }, { ...blk, ordinal: 1 }] })).rejects.toThrow(/already saved/);
  });

  test("rule 7.2 (round 6): the old shape with no preview is refused; nothing is saved as the reader's", async () => {
    const p = await plant(env);
    const { artifactId } = await begin(p.owner);
    const { preview: _, ...bare } = block({});
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [bare as never] })).rejects.toThrow();
    expect((await p.owner.ingest.artifact.get({ artifactId })).blocks).toEqual([]);
  });

  test("rule 5.1: a near fit is never trusted; ask names the layout it resembles and puts that row first", async () => {
    const p = await plant(env);
    await learnLayout(env, p.companyId, p.users.owner.id, bookLayout(), "Book");
    const { artifactId } = await begin(p.owner);
    const near = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Bakee (kg)"];
    const preview = [PREVIEW[0]!, { row: 1, cells: near }, ...PREVIEW.slice(2)];
    const put = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ headers: near, preview })] });
    expect(put.header[0]).toMatchObject({
      ordinal: 0,
      answer: "ask",
      guess: { headerRow: 1, headerRows: 1 },
      resembles: { name: "Book", target: "orders", fit: "near", headerRow: 1, headerRows: 1 },
    });
    expect((put.header[0] as { candidates: { headerRow: number; headerRows: number }[] }).candidates[0]).toEqual({ headerRow: 1, headerRows: 1 });
    expect(put.blocks).toEqual([]);
  });

  test("rule 5.1: a preview of 15 rows with a gap asks; a header far down the sheet can be picked", async () => {
    const p = await plant(env);
    await learnLayout(env, p.companyId, p.users.owner.id, bookLayout(), "Book");
    const { artifactId } = await begin(p.owner);
    const head = [0, 1, 2].map((row) => ({ row, cells: ["Fourcubes Extrusions", `note ${row}`, ""] }));
    const around = [
      ...Array.from({ length: 8 }, (_, i) => ({ row: 4991 + i, cells: ["", `note ${4991 + i}`, ""] })),
      { row: 4999, cells: BOOK },
      ...DATA.map((cells, i) => ({ row: 5000 + i, cells })),
    ];
    const preview = [...head, ...around];
    expect(preview).toHaveLength(15);
    const put = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ headerRow: 4999, preview })] });
    // The window moved (a gap after row 2), so the true header may lie outside it: always ask (M6).
    expect(put.header[0]).toMatchObject({ ordinal: 0, answer: "ask", resembles: { name: "Book", fit: "exact", headerRow: 4999 } });
    // Rule 7.2 (round 6): the pick is taken because the server asked about this table.
    const picked = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ headerRow: 4999, preview, hint: { headerRow: 4999, headerRows: 1 } })] });
    expect(picked.header[0]).toMatchObject({ answer: "keep", by: "person" });
  });

  test("the preview is at most 15 rows of at most 200 cells of at most 200 characters", async () => {
    const p = await plant(env);
    const { artifactId } = await begin(p.owner);
    const rows16 = Array.from({ length: 16 }, (_, i) => ({ row: i, cells: ["a", "b"] }));
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: rows16 })] })).rejects.toThrow();
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: [{ row: 0, cells: ["x".repeat(201)] }] })] })).rejects.toThrow();
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [block({ preview: [{ row: 0, cells: Array.from({ length: 201 }, () => "a") }] })] })).rejects.toThrow();
  });
});
