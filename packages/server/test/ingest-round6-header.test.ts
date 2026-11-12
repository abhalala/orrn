/**
 * Rule 7.2 (PORTAL-RULES-3, round 6): the header check cannot be skipped. Every table comes with its
 * preview; the server works out the column names from the preview row it settled and stores those;
 * a hint is a person's pick, taken only after the server asked (or after "Wrong columns? Pick the
 * row"), and recorded with who and when; rows are taken only as read under the settled header. The
 * checker's H2, H3, H4b, H7 and H10 (PORTAL-S-CHECK-5, S5-2) are the first tests.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, mergeOnce, plant, pump, trim, type Caller } from "./ingest-portal-helpers";

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
const LETTER = ["Fourcubes Extrusions", "Rajkot", "Gujarat", "", "", "", "", ""];
const ROW = ["Acme Traders", "41", "PO-9", "31/10/2025", "R", "5100", "3658", "100"];
const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

async function setup() {
  const p = await plant(env);
  await p.owner.customer.create({ name: "Acme Traders" });
  await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
  await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", BOOK, FIELDS, ["customer", "oldOrderNo", "orderDate"]), "Book");
  return p;
}

const begin = async (as: Caller) => (await as.ingest.artifact.begin({ sha256: sha(), fileName: "book.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" })).artifactId;
/** Letterhead on row 0, the Book names on row 1, one data row on row 2. */
const PREVIEW = [
  { row: 0, cells: LETTER },
  { row: 1, cells: BOOK },
  { row: 2, cells: ROW },
];
const block = (o: Record<string, unknown> = {}) => ({ ordinal: 0, sheetName: "A", title: null, headerRow: 1, headerRows: 1, headers: BOOK, rowCount: 1, sample: [ROW], preview: PREVIEW, ...o });

describe("rule 7.2: the header check cannot be skipped", () => {
  test("H2: a table with no preview is refused", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const { preview: _, ...bare } = block({ headers: LETTER, headerRow: 0 });
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [bare as never] })).rejects.toThrow();
  });

  test("H3: a pick sent before the server asked is refused", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block({ headerRow: 0, headers: LETTER, hint: { headerRow: 0, headerRows: 1 } })] })).rejects.toThrow(
      "orrn has not asked about this table. Send it without a pick first.",
    );
  });

  test("H4b: the names sent are not trusted; the server stores the names of the preview row it settled", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const out = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block({ headers: LETTER })] });
    expect(out.header[0]).toMatchObject({ answer: "keep", by: "fit" });
    const stored = await env.d1.prepare("select headers, header_by from ingest_block where artifact_id = ?").bind(id).first<{ headers: string; header_by: string }>();
    expect(JSON.parse(stored!.headers)).toEqual(BOOK);
    expect(out.candidates[0]).toMatchObject({ fit: "exact", target: "orders" });
  });

  test("H7: a preview row sent twice, or out of order, is refused", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const twice = [{ row: 1, cells: ["x", "y", "", "", "", "", "", ""] }, { row: 1, cells: BOOK }, { row: 2, cells: ROW }];
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block({ preview: twice })] })).rejects.toThrow("The preview has a row twice or out of order");
    const backwards = [{ row: 2, cells: ROW }, { row: 1, cells: BOOK }];
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block({ preview: backwards })] })).rejects.toThrow("The preview has a row twice or out of order");
  });

  test("a two-row pick whose second row is not in the preview is refused", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const odd = ["Kachha maal", "Vazan", "Rate", "", "", "", "", ""];
    const preview = [{ row: 0, cells: LETTER }, { row: 1, cells: odd }, { row: 2, cells: ["Om Metals", "120", "55", "", "", "", "", ""] }];
    expect((await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block({ headerRow: 0, headers: LETTER, preview })] })).header[0]!.answer).toBe("ask");
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block({ headerRow: 2, headerRows: 2, preview, hint: { headerRow: 2, headerRows: 2 } })] })).rejects.toThrow(
      "The column names row is not in the preview. Read the table again.",
    );
  });

  test("H10: after an ask, a pick outside the preview is refused; a pick of a preview row is recorded with who, when, lastDataRow and skipRows", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const odd = ["Kachha maal", "Vazan", "Rate", "", "", "", "", ""];
    const preview = [{ row: 0, cells: LETTER }, { row: 1, cells: odd }, { row: 2, cells: ["Om Metals", "120", "55", "", "", "", "", ""] }, { row: 3, cells: ["Kamal Bros", "80", "54", "", "", "", "", ""] }];
    const first = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block({ headerRow: 0, headers: LETTER, preview, sample: [preview[2]!.cells] })] });
    expect(first.header[0]).toMatchObject({ answer: "ask", follows: null, continuesAbove: false, sameColumnsAsAbove: false });
    await expect(
      p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block({ headerRow: 7, headers: BOOK, preview, hint: { headerRow: 7, headerRows: 1 } })] }),
    ).rejects.toThrow("The row you picked is not in the preview");
    const picked = await p.owner.ingest.artifact.putBlocks({
      artifactId: id,
      blocks: [block({ headerRow: 1, headers: odd, preview, rowCount: 2, sample: [preview[2]!.cells, preview[3]!.cells], hint: { headerRow: 1, headerRows: 1, lastDataRow: 3, skipRows: [] } })],
    });
    expect(picked.header[0]).toMatchObject({ answer: "keep", by: "person" });
    const stored = await env.d1.prepare("select headers, header_by, header_pick from ingest_block where artifact_id = ?").bind(id).first<{ headers: string; header_by: string; header_pick: string }>();
    expect(stored!.header_by).toBe("person");
    expect(JSON.parse(stored!.headers)).toEqual(["Kachha maal", "Vazan", "Rate"]);
    expect(JSON.parse(stored!.header_pick)).toMatchObject({ by: p.users.owner.id, at: expect.any(Number), headerRow: 1, headerRows: 1, lastDataRow: 3, skipRows: [] });
  });

  test("rows are taken only as read under the settled header", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const out = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block()] });
    const blockId = out.blocks[0]!.blockId;
    await expect(p.owner.ingest.artifact.putRows({ blockId, headerRow: 0, headerRows: 1, fromIndex: 0, expectRowsPut: 0, rows: [ROW] })).rejects.toThrow(
      "These rows were read under another header row. Read the table again.",
    );
    expect((await p.owner.ingest.artifact.putRows({ blockId, headerRow: 1, headerRows: 1, fromIndex: 0, expectRowsPut: 0, rows: [ROW] })).rowsPut).toBe(1);
  });

  test("a table that follows another with the same names is asked with the two offers and its follows", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const odd = ["Kachha maal", "Vazan", "Rate"];
    const data = ["Om Metals", "120", "55"];
    const upper = { ordinal: 0, sheetName: "A", title: null, headerRow: 0, headerRows: 1, rowCount: 1, sample: [data], preview: [{ row: 0, cells: odd }, { row: 1, cells: data }] };
    const lower = { ordinal: 1, sheetName: "A", title: null, headerRow: 4, headerRows: 1, rowCount: 1, sample: [data], preview: [{ row: 4, cells: odd }, { row: 5, cells: data }], follows: { ordinal: 0, gapRows: 2 } };
    const out = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [upper, lower] });
    expect(out.header.find((h) => h.ordinal === 1)).toMatchObject({ answer: "ask", sameColumnsAsAbove: true, follows: { ordinal: 0, gapRows: 2 } });
  });

  test("Wrong columns? Pick the row: resets a sheet with no row written; the pick is then taken; refused once rows are written", async () => {
    const p = await setup();
    const id = await begin(p.owner);
    const out = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block()] });
    await p.owner.ingest.artifact.putRows({ blockId: out.blocks[0]!.blockId, headerRow: 1, headerRows: 1, fromIndex: 0, expectRowsPut: 0, rows: [ROW] });
    await p.owner.ingest.artifact.complete({ artifactId: id });
    const cid = out.candidates[0]!.id;
    const seq = (await p.owner.ingest.candidate.get({ candidateId: cid })).serverSeq;
    expect(await p.owner.ingest.candidate.repickHeader({ candidateId: cid, expectSeq: seq })).toEqual({ artifactId: id, ordinal: 0 });
    const art = await p.owner.ingest.artifact.get({ artifactId: id });
    expect(art).toMatchObject({ readState: "reading", blocks: [] });
    const again = await p.owner.ingest.artifact.putBlocks({ artifactId: id, blocks: [block({ hint: { headerRow: 1, headerRows: 1 } })] });
    expect(again.header[0]).toMatchObject({ answer: "keep", by: "person" });
    await p.owner.ingest.artifact.putRows({ blockId: again.blocks[0]!.blockId, headerRow: 1, headerRows: 1, fromIndex: 0, expectRowsPut: 0, rows: [ROW] });
    await p.owner.ingest.artifact.complete({ artifactId: id });
    const c2 = again.candidates[0]!.id;
    await pump(p.owner, c2);
    await p.owner.ingest.candidate.approve({ candidateId: c2, expectSeq: (await p.owner.ingest.candidate.get({ candidateId: c2 })).serverSeq });
    expect((await mergeOnce(p.owner)).state).toBe("done");
    await expect(p.owner.ingest.candidate.repickHeader({ candidateId: c2, expectSeq: (await p.owner.ingest.candidate.get({ candidateId: c2 })).serverSeq })).rejects.toThrow(
      "Rows of this sheet are already written. Its columns cannot change now.",
    );
  });
});
