/**
 * Server round 8 (PORTAL-S-CHECK-6 and PORTAL-RULES-3 section 10).
 * - 10.1 (S6-1): a blank date, PO or party is filled from the nearest filled row above in the same
 *   run. A line that took its date from above, in a run of one number that holds two dates, asks the
 *   file once:
 *   `order_fill_above`, "Some lines have no date. orrn took each one's date from the dated line just
 *   above it. Is that right?" Yes keeps the fill; No refuses those lines with `order_no_date:<n>`.
 * - 10.2 (S6-2): nothing is approved or merged while its file is being read; the check is in the batch.
 * - 10.3 (S6-3): a reader keep with no question only for an all-text guess of two or more filled
 *   cells with no blank between them, over a row with a number or a date.
 * - S6-4: reader facts text is masked for a viewer without order.price, as the sample is.
 * - 10.2 second line (S6-5): re-put and repick refuse once any sheet of the file is approved or merging.
 * - S6-6: a re-put of a 50-block file binds at most 100 values a statement.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, D1_MAX_PARAMS, type TestEnv } from "./harness";
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
const R = (no: string, po: string, date: string, sec: string) => ["Acme Traders", no, po, date, "R", sec, "3658", "100"];

async function setup() {
  const p = await plant(env);
  await p.owner.customer.create({ name: "Acme Traders" });
  for (const code of ["5100", "5101", "5102", "5103"]) await env.seedDie(p.companyId, { series: "R", sectionCode: code });
  await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", BOOK, FIELDS, ["customer", "oldOrderNo", "orderDate"]), "Book");
  return p;
}

const seqOf = async (as: Caller, candidateId: string) => (await as.ingest.candidate.get({ candidateId })).serverSeq;

async function tryApprove(as: Caller, candidateId: string): Promise<string> {
  try {
    await as.ingest.candidate.approve({ candidateId, expectSeq: await seqOf(as, candidateId) });
    return "approved";
  } catch (e) {
    return `REFUSED: ${(e as Error).message}`;
  }
}

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

const TWO_YEARS = [R("41", "PO-A", "01/05/2023", "5100"), R("41", "", "", "5101"), R("41", "PO-B", "01/06/2024", "5102"), R("41", "", "", "5103")];

describe("rule 10.1 (S6-1): the nearest filled row above, and one question when a run holds two values", () => {
  test("before the answer nothing merges; Yes puts each blank line on the order just above it", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ name: "Book", headers: BOOK, rows: TWO_YEARS }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ambiguous", "ambiguous", "ambiguous", "ambiguous"]);
    expect(rows[1]!.reasons).toContain("q:order_fill_above");
    expect(rows[3]!.reasons).toContain("q:order_fill_above");
    expect(rows[0]!.reasons).not.toContain("q:order_fill_above");
    const q = (await p.owner.ingest.candidate.get({ candidateId: id })).questions.find((x) => x.code === "order_fill_above");
    expect(q).toMatchObject({ subject: "", open: true, params: { count: 2 } });
    expect(q!.lines).toEqual([
      { row: 1, order: "41", date: "2023-05-01", po: "PO-A" },
      { row: 3, order: "41", date: "2024-06-01", po: "PO-B" },
    ]);
    expect(await tryApprove(p.owner, id)).toBe("REFUSED: Answer every question first");
    expect(await orders(p.companyId)).toEqual([]);

    await p.owner.ingest.answer.set({ candidateId: id, questionCode: "order_fill_above", subject: "", answer: true, expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create", "ready_create"]);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([
      { date: "2023-05-01", po: "PO-A", codes: "5100,5101" },
      { date: "2024-06-01", po: "PO-B", codes: "5102,5103" },
    ]);
  });

  test("No refuses both blank lines with order_no_date:41; the dated lines still write whole", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ name: "Book", headers: BOOK, rows: TWO_YEARS }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    await p.owner.ingest.answer.set({ candidateId: id, questionCode: "order_fill_above", subject: "", answer: false, expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "refused", "ready_create", "refused"]);
    expect(rows[1]!.reasons).toContain("order_no_date:41");
    expect(rows[3]!.reasons).toContain("order_no_date:41");
    expect(rows[1]!.reasons.some((r) => r.startsWith("filled_down:"))).toBe(false);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await orders(p.companyId)).toEqual([
      { date: "2023-05-01", po: "PO-A", codes: "5100" },
      { date: "2024-06-01", po: "PO-B", codes: "5102" },
    ]);
  });

  test("a run with one value fills from the nearest filled row above, with no question", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [{ name: "Book", headers: BOOK, rows: [R("42", "PO-C", "01/05/2025", "5100"), R("42", "", "", "5101"), R("42", "", "", "5102")] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create"]);
    expect((await p.owner.ingest.candidate.get({ candidateId: id })).questions.some((x) => x.code === "order_fill_above")).toBe(false);
  });

  test("one question for the file: the answer on one sheet settles the other sheet's lines", async () => {
    const p = await setup();
    const { candidates } = await upload(p.owner, [
      { name: "Book", headers: BOOK, rows: TWO_YEARS },
      { name: "Book 2", headers: BOOK, rows: [R("43", "PO-D", "01/05/2023", "5100"), R("43", "", "", "5101"), R("43", "PO-E", "01/06/2024", "5102"), R("43", "", "", "5103")] },
    ]);
    const [a, b] = [candidates[0]!.id, candidates[1]!.id];
    await pump(p.owner, a);
    await pump(p.owner, b);
    await p.owner.ingest.answer.set({ candidateId: a, questionCode: "order_fill_above", subject: "", answer: true, expectSeq: await seqOf(p.owner, a) });
    await pump(p.owner, a);
    await pump(p.owner, b);
    expect((await rowsOf(p.owner, b)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create", "ready_create"]);
    const qb = (await p.owner.ingest.candidate.get({ candidateId: b })).questions.find((x) => x.code === "order_fill_above");
    expect(qb).toMatchObject({ open: false, answer: true });
  });
});

describe("rule 10.2 (S6-2): nothing is approved or merged while its file is being read", () => {
  const READING = "This file is being read again. Finish it, then approve.";
  const blockOf = (ordinal: number, name: string, rows: string[][], hint?: { lastDataRow: number }) => ({
    ordinal,
    sheetName: name,
    title: null,
    headerRow: 0,
    headerRows: 1,
    rowCount: rows.length,
    sample: rows,
    preview: [{ row: 0, cells: BOOK }, ...rows.map((cells, i) => ({ row: i + 1, cells }))],
    ...(hint ? { hint: { headerRow: 0, headerRows: 1 as const, lastDataRow: hint.lastDataRow, skipRows: [] } } : {}),
  });

  test("a sheet put again with a pick sends the file back to reading: the other sheet cannot be approved until it is read", async () => {
    const p = await setup();
    const A = [R("41", "PO-41", "31/10/2025", "5100")];
    const { artifactId, candidates } = await upload(p.owner, [
      { name: "A", headers: BOOK, rows: A },
      { name: "B", headers: BOOK, rows: [R("42", "PO-42", "31/10/2025", "5100")] },
    ]);
    const a = candidates[0]!.id;
    await pump(p.owner, a);
    expect((await p.owner.ingest.candidate.get({ candidateId: a })).state).toBe("ready");
    const B2 = [R("42", "PO-42", "31/10/2025", "5100"), R("41", "PO-41", "31/10/2025", "5101")];
    const again = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [blockOf(0, "A", A), blockOf(1, "B", B2, { lastDataRow: 2 })] });
    expect((await p.owner.ingest.artifact.get({ artifactId })).readState).toBe("reading");
    expect(await tryApprove(p.owner, a)).toBe(`REFUSED: ${READING}`);
    expect((await p.owner.ingest.candidate.get({ candidateId: a })).state).toBe("ready");
    // Once read again, the two sheets of order 41 meet: nothing of it is written from one sheet alone.
    await putRowsAs(p.owner, { blockId: again.blocks[1]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: B2 });
    await p.owner.ingest.artifact.complete({ artifactId });
    const b = again.candidates.find((c) => c.blockOrdinal === 1)!.id;
    await pump(p.owner, b);
    const rb = await rowsOf(p.owner, b);
    expect(rb[1]!.reasons.some((r) => r.startsWith("order_in_other_file"))).toBe(true);
  });

  test("an approved sheet in a file being read is not merged", async () => {
    const p = await setup();
    const { artifactId, candidates } = await upload(p.owner, [{ name: "A", headers: BOOK, rows: [R("41", "PO-41", "31/10/2025", "5100")] }]);
    const a = candidates[0]!.id;
    await pump(p.owner, a);
    expect(await tryApprove(p.owner, a)).toBe("approved");
    await env.d1.prepare("update ingest_artifact set read_state = 'reading' where id = ?").bind(artifactId).run();
    await expect(p.owner.ingest.merge.start()).rejects.toThrow("A file is being read again. Finish it, then merge.");
    expect((await p.owner.ingest.candidate.get({ candidateId: a })).state).toBe("approved");
    expect(await orders(p.companyId)).toEqual([]);
  });
});

describe("rule 10.3 (S6-3): the clean-sheet keep is narrow", () => {
  const sha = () => crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
  const put = async (as: Caller, preview: { row: number; cells: string[] }[]) => {
    const { artifactId } = await as.ingest.artifact.begin({ sha256: sha(), fileName: "odd.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
    const rows = preview.slice(1).map((p) => p.cells);
    const out = await as.ingest.artifact.putBlocks({
      artifactId,
      blocks: [{ ordinal: 0, sheetName: "S", title: null, headerRow: preview[0]!.row, headerRows: 1, rowCount: rows.length, sample: rows, preview }],
    });
    return out.header[0]!;
  };

  test("R3: a row of column numbers on top asks, with the names row among the candidates", async () => {
    const p = await setup();
    const h = await put(p.owner, [
      { row: 0, cells: ["1", "2", "3", "4", "5"] },
      { row: 1, cells: ["Colour", "Shade", "Batch", "Lot", "Rate"] },
      { row: 2, cells: ["Om Metals", "98250 11111", "Rajkot", "120", "256.50"] },
    ]);
    expect(h.answer).toBe("ask");
    expect(h.answer === "ask" && h.candidates.some((c) => c.headerRow === 1)).toBe(true);
  });

  test("a guess with one filled cell, or a blank between filled cells, asks", async () => {
    const p = await setup();
    expect((await put(p.owner, [{ row: 0, cells: ["Kharidi", "", ""] }, { row: 1, cells: ["Om Metals", "120", "210"] }])).answer).toBe("ask");
    expect((await put(p.owner, [{ row: 0, cells: ["Party", "", "Vazan"] }, { row: 1, cells: ["Om Metals", "120", "210"] }])).answer).toBe("ask");
  });

  test("a guess over a row with no number or date asks; over a row with one it is kept by the reader", async () => {
    const p = await setup();
    const h = await put(p.owner, [{ row: 0, cells: ["Colour", "Shade", "Note"] }, { row: 1, cells: ["Red", "Dark", "good"] }]);
    expect(h).toMatchObject({ answer: "ask" });
    expect(await put(p.owner, [{ row: 0, cells: ["Colour", "Shade", "Vazan"] }, { row: 1, cells: ["Red", "Dark", "120"] }])).toMatchObject({ answer: "keep", by: "reader" });
    expect(await put(p.owner, [{ row: 0, cells: ["Colour", "Shade", "Din"] }, { row: 1, cells: ["Red", "Dark", "01/05/2025"] }])).toMatchObject({ answer: "keep", by: "reader" });
  });
});

describe("S6-4: reader facts text and rates", () => {
  test("R4: without order.price the warnings and sections text of a block with a rate column is blank", async () => {
    const p = await setup();
    const { artifactId } = await p.owner.ingest.artifact.begin({ sha256: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"), fileName: "rates.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
    const NAMES = ["Colour", "Shade", "Batch", "Lot", "Rate"];
    const row = ["Om Metals", "98250 11111", "Rajkot", "120", "256.50"];
    await p.owner.ingest.artifact.putBlocks({
      artifactId,
      blocks: [
        {
          ordinal: 0,
          sheetName: "S",
          title: null,
          headerRow: 0,
          headerRows: 1,
          rowCount: 1,
          sample: [row],
          preview: [{ row: 0, cells: NAMES }, { row: 1, cells: row }],
          warnings: [
            { code: "after_last_row", row: 5, text: "Om Metals 98250 11111 Rajkot 120 256.50" },
            { code: "skipped_title", row: 3, text: "Rate list 256.50" },
          ],
          sections: [{ row: 2, text: "Rates at 256.50" }],
        },
      ],
    });
    const hidden = (await p.admin.ingest.artifact.get({ artifactId })).blocks[0]!;
    expect(hidden.sample[0]![4]).toBe("");
    expect(JSON.stringify({ w: hidden.warnings, s: hidden.sections })).not.toContain("256.50");
    expect(hidden.warnings.map((w) => [w.code, w.row])).toEqual([
      ["after_last_row", 5],
      ["skipped_title", 3],
    ]);
    const shown = (await p.owner.ingest.artifact.get({ artifactId })).blocks[0]!;
    expect(shown.warnings[0]!.text).toBe("Om Metals 98250 11111 Rajkot 120 256.50");
    expect(shown.sections[0]!.text).toBe("Rates at 256.50");
  });

  test("a block with no rate column keeps its text, unless the text reads as a rate", async () => {
    const p = await setup();
    const { artifactId } = await p.owner.ingest.artifact.begin({ sha256: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"), fileName: "plain.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
    const NAMES = ["Colour", "Shade", "Batch"];
    const row = ["Red", "Dark", "120"];
    await p.owner.ingest.artifact.putBlocks({
      artifactId,
      blocks: [
        {
          ordinal: 0,
          sheetName: "S",
          title: null,
          headerRow: 0,
          headerRows: 1,
          rowCount: 1,
          sample: [row],
          preview: [{ row: 0, cells: NAMES }, { row: 1, cells: row }],
          warnings: [
            { code: "after_last_row", row: 5, text: "Total 120" },
            { code: "after_last_row", row: 6, text: "Rate Rs 256.50 per kg" },
          ],
          sections: [{ row: 2, text: "December" }],
        },
      ],
    });
    const b = (await p.admin.ingest.artifact.get({ artifactId })).blocks[0]!;
    expect(b.warnings.map((w) => w.text)).toEqual(["Total 120", ""]);
    expect(b.sections[0]!.text).toBe("December");
  });
});

describe("rule 10.2 second line (S6-5): no re-put or repick once a sheet of the file is approved", () => {
  const APPROVED = "A sheet of this file is approved. Its tables cannot change now.";

  test("a sheet approved: the other sheet cannot be picked again or put again", async () => {
    const p = await setup();
    const { artifactId, candidates } = await upload(p.owner, [
      { name: "A", headers: BOOK, rows: [R("41", "PO-41", "31/10/2025", "5100")] },
      { name: "B", headers: BOOK, rows: [R("42", "PO-42", "31/10/2025", "5100")] },
    ]);
    const [a, b] = [candidates[0]!.id, candidates[1]!.id];
    await pump(p.owner, a);
    expect(await tryApprove(p.owner, a)).toBe("approved");
    await expect(p.owner.ingest.candidate.repickHeader({ candidateId: b, expectSeq: await seqOf(p.owner, b) })).rejects.toThrow(APPROVED);
    const blocks = (await p.owner.ingest.artifact.get({ artifactId })).blocks;
    const sent = blocks.map((x) => ({
      ordinal: x.ordinal,
      sheetName: x.sheetName,
      title: null,
      headerRow: 0,
      headerRows: 1,
      rowCount: x.rowCount,
      sample: x.sample,
      preview: [{ row: 0, cells: BOOK }, ...x.sample.map((cells, i) => ({ row: i + 1, cells }))],
    }));
    await expect(p.owner.ingest.artifact.putBlocks({ artifactId, blocks: [sent[0]!, { ...sent[1]!, hint: { headerRow: 0, headerRows: 1, lastDataRow: 1, skipRows: [] } }] })).rejects.toThrow(APPROVED);
    expect((await p.owner.ingest.candidate.get({ candidateId: a })).state).toBe("approved");
  });
});

describe("S6-6: the re-put statements are chunked", () => {
  test("50 order sheets, each with its new customers list: changing every sheet binds at most 100 values a statement", async () => {
    const p = await setup();
    const sheets = Array.from({ length: 50 }, (_, i) => ({
      name: `S${i}`,
      headers: BOOK,
      rows: [[`New Party ${i}`, String(100 + i), `PO-${i}`, "31/10/2025", "R", "5100", "3658", "100"]],
    }));
    const { artifactId, candidates } = await upload(p.owner, sheets, "fifty.xlsx");
    for (const c of candidates) {
      await pump(p.owner, c.id);
      await p.owner.ingest.answer.set({ candidateId: c.id, questionCode: "new_customers", subject: "", answer: true, expectSeq: await seqOf(p.owner, c.id) });
      await pump(p.owner, c.id);
    }
    const before = await env.d1.prepare("select count(*) as n from ingest_candidate where artifact_id = ?").bind(artifactId).first<{ n: number }>();
    expect(Number(before!.n)).toBe(100);
    const blocks = sheets.map((sh, ordinal) => ({
      ordinal,
      sheetName: sh.name,
      title: null,
      headerRow: 0,
      headerRows: 1,
      rowCount: 1,
      sample: sh.rows,
      preview: [{ row: 0, cells: BOOK }, { row: 1, cells: sh.rows[0]! }],
      hint: { headerRow: 0, headerRows: 1 as const, lastDataRow: 1, skipRows: [] },
    }));
    env.resetPeakParams();
    const again = await p.owner.ingest.artifact.putBlocks({ artifactId, blocks });
    expect(env.peakParams()).toBeLessThanOrEqual(D1_MAX_PARAMS);
    expect(again.blocks).toHaveLength(50);
    const after = await env.d1.prepare("select count(*) as n from ingest_candidate where artifact_id = ?").bind(artifactId).first<{ n: number }>();
    expect(Number(after!.n)).toBe(50);
  }, 120_000);
});
