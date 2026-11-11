/**
 * Rule 5.3 (PORTAL-RULES-3): a PDF reader marks a row it is not sure it split right. The server
 * stores the doubts with the staged row and the row is never ready on its own: a person says it is
 * right (recorded in the audit meta) or skips it, one row at a time or all at once after opening the
 * list (the count shown comes back, so a stale screen cannot confirm rows it did not show).
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, mergeOnce, plant, pump, rowsOf, trim, type Caller } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const HEADERS = ["Name", "GSTIN", "City"];
const ROWS = [
  ["Acme Traders", "", "Surat"],
  ["Bharat Metals", "", "Rajkot"],
  ["Kamal Bros", "", "Morbi"],
  ["Om Metals", "", "Gondal"],
];
type Doubt = { row: number; code: "crosses_column" | "cells_joined" | "cells_close" | "few_columns" | "off_column"; line: number; page?: number };

async function send(as: Caller, rows: string[][], doubts: Doubt[], headers = HEADERS) {
  const begin = await as.ingest.artifact.begin({ sha256: createHash("sha256").update(randomUUID()).digest("hex"), fileName: "parties.pdf", sizeBytes: 1000, contentType: null, kind: "pdf_text" });
  const put = await as.ingest.artifact.putBlocks({
    artifactId: begin.artifactId,
    blocks: [{ ordinal: 0, sheetName: null, title: null, headerRow: 0, headerRows: 1, headers, rowCount: rows.length, sample: rows }],
  });
  await as.ingest.artifact.putRows({ blockId: put.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows, doubts });
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  const candidateId = put.candidates[0]!.id;
  await pump(as, candidateId);
  return candidateId;
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

describe("rule 5.3: a row in doubt is checked against the file by a person", () => {
  test("a doubted row is never ready; it shows the page, line and code; approve is refused until it is answered", async () => {
    const p = await plant(env);
    const id = await send(p.owner, ROWS, [
      { row: 1, code: "cells_close", line: 7, page: 2 },
      { row: 2, code: "crosses_column", line: 8, page: 2 },
      { row: 2, code: "few_columns", line: 8, page: 2 },
    ]);
    const rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ambiguous", "ambiguous", "ready_create"]);
    expect(rows[1]!.reasons).toContain("check_against_file");
    expect(rows[1]!.doubts).toEqual([{ code: "cells_close", line: 7, page: 2 }]);
    expect(rows[2]!.doubts.map((d) => d.code)).toEqual(["crosses_column", "few_columns"]);
    expect(rows[1]!.doubtConfirmed).toBe(false);
    expect(rows[0]!.doubts).toEqual([]);
    expect(await tryApprove(p.owner, id)).toBe("REFUSED: Check 2 rows against the file first. Open the list, then say each is right or skip it.");
  });

  test("one row confirmed and one skipped; a re-run of the dry run keeps both answers; the audit meta records the confirmation", async () => {
    const p = await plant(env);
    const id = await send(p.owner, ROWS, [
      { row: 1, code: "cells_close", line: 7, page: 2 },
      { row: 2, code: "off_column", line: 8, page: 2 },
    ]);
    const [, r1, r2] = await rowsOf(p.owner, id);
    await p.owner.ingest.rows.answerDoubts({ candidateId: id, answer: "right", rowId: r1!.id, expectSeq: await seqOf(p.owner, id) });
    await p.owner.ingest.rows.answerDoubts({ candidateId: id, answer: "skip", rowId: r2!.id, expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    let rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ready_create", "skipped", "ready_create"]);
    expect(rows[1]!.doubtConfirmed).toBe(true);
    // Another decision re-runs the dry run from row 0: the answers stay.
    await p.owner.ingest.rows.decide({ candidateId: id, rowIds: [rows[0]!.id], decision: "skip", expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["skipped", "ready_create", "skipped", "ready_create"]);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    const audit = await env.d1
      .prepare("select json_extract(meta, '$.source.confirmed') as c from audit_log where company_id = ? and json_extract(meta, '$.source.candidateId') = ? and json_extract(meta, '$.source.confirmed') is not null")
      .bind(p.companyId, id)
      .all<{ c: string }>();
    expect(audit.results.map((a) => JSON.parse(a.c))).toEqual([[{ row: 1, by: p.users.owner.id, codes: ["cells_close"] }]]);
  });

  test("all at once only with the count the person saw; a stale count is refused", async () => {
    const p = await plant(env);
    const id = await send(p.owner, ROWS, [
      { row: 0, code: "cells_joined", line: 3 },
      { row: 3, code: "few_columns", line: 9 },
    ]);
    const list = await p.owner.ingest.rows.doubts({ candidateId: id, limit: 50 });
    expect(list.open).toBe(2);
    expect(list.items.map((r) => r.rowIndex)).toEqual([0, 3]);
    await expect(p.owner.ingest.rows.answerDoubts({ candidateId: id, answer: "right", expectCount: 1, expectSeq: await seqOf(p.owner, id) })).rejects.toThrow(
      "The list of rows to check changed. Open it again.",
    );
    await p.owner.ingest.rows.answerDoubts({ candidateId: id, answer: "right", expectCount: 2, expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "ready_create", "ready_create"]);
    expect((await p.owner.ingest.rows.doubts({ candidateId: id, limit: 50 })).open).toBe(0);
    expect(await tryApprove(p.owner, id)).toBe("approved");
  });

  test("skip all at once", async () => {
    const p = await plant(env);
    const id = await send(p.owner, ROWS, [{ row: 2, code: "cells_close", line: 5 }]);
    await p.owner.ingest.rows.answerDoubts({ candidateId: id, answer: "skip", expectCount: 1, expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    expect((await rowsOf(p.owner, id)).map((r) => r.state)).toEqual(["ready_create", "ready_create", "skipped", "ready_create"]);
  });

  test("a doubted row that is also refused shows both reasons", async () => {
    const p = await plant(env);
    const id = await send(p.owner, [["", "", "Surat"], ...ROWS.slice(1)], [{ row: 0, code: "few_columns", line: 4 }]);
    const [r0] = await rowsOf(p.owner, id);
    expect(r0!.state).toBe("refused");
    expect(r0!.reasons).toContain("check_against_file");
    expect(r0!.reasons.length).toBeGreaterThan(1);
  });

  test("an order line in doubt waits through the whole-order pass; once confirmed the order is written whole", async () => {
    const p = await plant(env);
    await p.owner.customer.create({ name: "Acme Traders" });
    for (const code of ["5100", "5101"]) await env.seedDie(p.companyId, { series: "R", sectionCode: code });
    const BOOK = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
    const fields = [
      { field: "customer", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "customer_by_name" as const }] },
      { field: "oldOrderNo", steps: trim },
      { field: "poNumber", steps: trim },
      { field: "orderDate", steps: [{ op: "date" as const, format: "dmy" as const }] },
      { field: "series", steps: [{ op: "trim" as const }, { op: "case" as const, to: "upper" as const }] },
      { field: "sectionCode", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "section_by_code" as const }] },
      { field: "cutLength", steps: [{ op: "number" as const, kind: "length" as const, unit: "mm" }] },
      { field: "bakiKg", steps: [{ op: "number" as const, kind: "mass" as const, unit: "kg" }] },
    ];
    await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", BOOK, fields, ["customer", "oldOrderNo", "orderDate"]), "Book");
    const line = (sec: string) => ["Acme Traders", "41", "PO-9", "31/10/2025", "R", sec, "3658", "100"];
    const id = await send(p.owner, [line("5100"), line("5101")], [{ row: 1, code: "cells_close", line: 12, page: 1 }], BOOK);
    let rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ambiguous"]);
    expect(rows[1]!.reasons).toContain("check_against_file");
    expect(await tryApprove(p.owner, id)).toStartWith("REFUSED: Check 1 row against the file first.");
    await p.owner.ingest.rows.answerDoubts({ candidateId: id, answer: "right", rowId: rows[1]!.id, expectSeq: await seqOf(p.owner, id) });
    await pump(p.owner, id);
    rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "ready_create"]);
    expect(await tryApprove(p.owner, id)).toBe("approved");
    expect((await mergeOnce(p.owner)).state).toBe("done");
    const lines = await env.d1.prepare("select count(*) as n from sales_order_line l join sales_order o on o.id = l.sales_order_id where o.company_id = ?").bind(p.companyId).first<{ n: number }>();
    expect(Number(lines?.n)).toBe(2);
  });

  test("a row held only for its doubt takes no other decision", async () => {
    const p = await plant(env);
    const id = await send(p.owner, ROWS, [{ row: 1, code: "cells_close", line: 5 }]);
    const [, r1] = await rowsOf(p.owner, id);
    await expect(p.owner.ingest.rows.decide({ candidateId: id, rowIds: [r1!.id], decision: "keep_file", expectSeq: await seqOf(p.owner, id) })).rejects.toThrow(
      "Check this row against the file: say it is right, or skip it",
    );
  });

  test("doubts are bounded: one entry per row and code, only for rows in the call", async () => {
    const p = await plant(env);
    await expect(send(p.owner, ROWS, [{ row: 4, code: "cells_close", line: 5 }])).rejects.toThrow("A doubt names a row that was not sent");
    await expect(
      send(p.owner, ROWS, [
        { row: 1, code: "cells_close", line: 5 },
        { row: 1, code: "cells_close", line: 6 },
      ]),
    ).rejects.toThrow("A row has the same doubt twice");
  });
});
