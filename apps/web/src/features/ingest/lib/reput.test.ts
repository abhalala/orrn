import { describe, expect, test } from "bun:test";

import type { IngestApi } from "./api";
import { planReput, type StoredBlock } from "./reput";
import type { ReadBlock, SheetHints } from "./reader-protocol";
import { readFacts } from "./review-model";
import { refusalLine, refusalText } from "./refusals";
import { ReputError, uploadOneFile, type UploadReader } from "./upload";

/** A table of a sheet read by the guess: raw header row, data rows right under it. */
function block(ordinal: number, o: { header: number; rows: number; follows?: boolean; titleRows?: number[]; rowBase?: number; hint?: boolean }): ReadBlock {
  const rows = Array.from({ length: o.rows }, (_, i) => [`r${ordinal}-${i}`, String(i + 1)]);
  return {
    input: { ordinal, sheetName: "S", title: null, headerRow: o.header, headerRows: 1, headers: ["Name", "Kg"], rowCount: o.rows, sample: [], preview: [{ row: o.header, cells: ["Name", "Kg"] }] },
    rows,
    meta: {
      sheetName: "S", tableIndex: ordinal, part: 0, guess: { headerRow: o.header, headerRows: 1 }, hints: o.hint ? { headerRow: o.header, headerRows: 1, lastDataRow: o.header + o.rows } : null,
      follows: o.follows ? { block: ordinal - 1, gapRows: 1, continues: true } : null, rowBase: o.rowBase ?? 0, preview: [], firstDataRow: o.header + 1,
      lastDataRow: o.header + o.rows, titleRows: o.titleRows ?? [], gaps: 0, sections: [], leftOut: [],
    },
  };
}
const stored = (ordinal: number, headerRow: number): StoredBlock => ({ ordinal, sheetName: "S", headerRow, headerRows: 1 });

describe("planning a table put again", () => {
  test("start a new table here: the table ends on the row above the title", () => {
    const guess = [block(0, { header: 0, rows: 10 })];
    const plan = planReput(guess, [stored(0, 0)], { kind: "newTable", ordinal: 0, row: 5 });
    expect(plan!.hints).toEqual([{ sheet: "S", hint: { headerRow: 0, headerRows: 1, lastDataRow: 4 } }]);
  });

  test("the sheet's own row numbering is taken off: a sheet that starts at row 3 and a title on its row 8", () => {
    const guess = [block(0, { header: 0, rows: 10, rowBase: 2 })];
    const plan = planReput(guess, [stored(0, 0)], { kind: "newTable", ordinal: 0, row: 7 });
    expect(plan!.hints[0]!.hint.lastDataRow).toBe(4);
  });

  test("a title above the table's own first row cannot start a table", () => {
    expect(planReput([block(0, { header: 0, rows: 10 })], [stored(0, 0)], { kind: "newTable", ordinal: 0, row: 0 })).toBeNull();
  });

  test("it continues the table above: the table above runs to the end of this one, skipping this one's titles; this one has no hint", () => {
    const guess = [block(0, { header: 0, rows: 3 }), block(1, { header: 6, rows: 3, follows: true, titleRows: [5] })];
    const plan = planReput(guess, [stored(0, 0), stored(1, 6)], { kind: "continues", ordinal: 1 });
    expect(plan!.hints).toEqual([{ sheet: "S", hint: { headerRow: 0, headerRows: 1, lastDataRow: 9, skipRows: [5] } }]);
  });

  test("a person's earlier pick is kept: a stored header the reader does not guess goes back as a hint", () => {
    const guess = [block(0, { header: 1, rows: 3 }), block(1, { header: 8, rows: 2 })];
    const plan = planReput(guess, [stored(0, 3), stored(1, 8)], { kind: "newTable", ordinal: 1, row: 10 });
    expect(plan!.hints.map((h) => h.hint.headerRow).sort()).toEqual([3, 8]);
  });

  test("nothing to plan when the file reads differently from what is stored", () => {
    expect(planReput([], [stored(0, 0)], { kind: "newTable", ordinal: 0, row: 5 })).toBeNull();
    expect(planReput([block(0, { header: 0, rows: 4 })], [stored(0, 0)], { kind: "continues", ordinal: 0 })).toBeNull();
  });
});

describe("the whole put again, through the upload", () => {
  function setup(extra: Partial<Record<keyof IngestApi, unknown>> = {}) {
    const puts: { ordinals: number[]; hints: (unknown | undefined)[] }[] = [];
    const rowsPut: { blockId: string; n: number }[] = [];
    const calls: string[] = [];
    const reads: (SheetHints[] | undefined)[] = [];
    const api = {
      artifactBegin: async () => ({ artifactId: "A1", existing: true, uploadedAt: 1, upload: null }),
      artifactCommitRaw: async () => ({}),
      artifactGet: async () => ({ readState: "read", vaultState: "stored", blocks: [{ id: "B0", ordinal: 0, rowCount: 10, rowsPut: 10 }] }),
      artifactPutBlocks: async (i: { blocks: { ordinal: number; hint?: unknown }[] }) => {
        puts.push({ ordinals: i.blocks.map((b) => b.ordinal), hints: i.blocks.map((b) => b.hint) });
        return {
          blocks: i.blocks.map((b) => ({ blockId: `N${b.ordinal}`, ordinal: b.ordinal })), candidates: [],
          header: i.blocks.map((b) => ({ ordinal: b.ordinal, answer: "keep", by: b.hint ? "person" : "fit", blockId: `N${b.ordinal}` })),
        };
      },
      artifactPutRows: async (i: { blockId: string; fromIndex: number; rows: string[][] }) => (rowsPut.push({ blockId: i.blockId, n: i.rows.length }), { rowsPut: i.fromIndex + i.rows.length }),
      artifactComplete: async () => (calls.push("complete"), { canonicalUploads: [] }),
      candidateDiscard: async () => ({}),
      ...extra,
    } as unknown as IngestApi;
    const reader: UploadReader = {
      hash: async () => "sha",
      read: async (_f, opts) => {
        reads.push(opts.hints);
        const hinted = !!opts.hints;
        const blocks = hinted ? [block(0, { header: 0, rows: 5, hint: true }), block(1, { header: 7, rows: 4 })] : [block(0, { header: 0, rows: 10 })];
        return { kind: "sheet", blocks, rawRows: 12 };
      },
    };
    return { api, reader, puts, rowsPut, calls, reads };
  }
  const file = new File(["PK\u0003\u0004" + "x".repeat(40)], "Book.xlsx");

  test("the whole list goes again with the changed table's hint, rows go only for the new blocks, then complete", async () => {
    const t = setup();
    const out = await uploadOneFile(file, { api: t.api, reader: t.reader, fetch: (async () => new Response("{}")) as unknown as typeof fetch }, {
      onItem: () => undefined,
      reput: { sha256: "sha", stored: [stored(0, 0)], action: { kind: "newTable", ordinal: 0, row: 6 } },
    });
    expect(out.step).toBe("done");
    expect(t.reads[0]).toBeUndefined();
    expect(t.reads[1]).toEqual([{ sheetName: "S", hints: [{ headerRow: 0, headerRows: 1, lastDataRow: 5 }] }]);
    expect(t.puts[0]!.ordinals).toEqual([0, 1]);
    expect(t.puts[0]!.hints[0]).toMatchObject({ headerRow: 0, headerRows: 1, lastDataRow: 5 });
    expect(t.rowsPut).toEqual([{ blockId: "N0", n: 5 }, { blockId: "N1", n: 4 }]);
    expect(t.calls).toEqual(["complete"]);
  });

  test("a different file is refused before anything is sent", async () => {
    const t = setup();
    const reader = { ...t.reader, hash: async () => "other" };
    await expect(
      uploadOneFile(file, { api: t.api, reader }, { onItem: () => undefined, reput: { sha256: "sha", stored: [stored(0, 0)], action: { kind: "newTable", ordinal: 0, row: 6 } } }),
    ).rejects.toBeInstanceOf(ReputError);
    expect(t.puts).toEqual([]);
  });

  test("the server's refusal after a row is written reaches the screen as its code's words", async () => {
    const refused = Object.assign(new Error("Rows of this sheet are already written. Its columns cannot change now."), { data: { code: "BAD_REQUEST" } });
    const t = setup({ artifactPutBlocks: async () => { throw refused; } });
    await expect(
      uploadOneFile(file, { api: t.api, reader: t.reader }, { onItem: () => undefined, reput: { sha256: "sha", stored: [stored(0, 0)], action: { kind: "newTable", ordinal: 0, row: 6 } } }),
    ).rejects.toBe(refused);
  });
});

describe("what the reader said, on the read panel", () => {
  test("gaps, listed lines, titles and the counts beyond the lists", () => {
    const facts = readFacts({
      gaps: 2,
      warnings: [{ code: "skipped_title", row: 4, text: "December" }],
      warningsTotal: 250,
      sections: [{ row: 4, text: "December" }],
      sectionsTotal: 1,
    });
    expect(facts).toEqual({
      gaps: 2,
      warnings: [{ n: 5, code: "skipped_title", text: "December" }],
      moreWarnings: 249,
      sections: [{ n: 5, row: 4, text: "December" }],
      moreSections: 0,
    });
    expect(readFacts({ gaps: 0, warnings: [], sections: [] })).toBeNull();
    expect(readFacts({})).toBeNull();
  });
});

describe("a numbered line with no date (order_no_date)", () => {
  test("the order number as the file has it is in the sentence", () => {
    const line = refusalLine("order_no_date:41")!;
    const t = (key: string, vars?: Record<string, string | number>) => `${key}|${vars?.n}`;
    expect(refusalText(t, line)).toBe("ingest.refuse.order_no_date|41");
  });
});

describe("the refusal once a row is written", () => {
  test("it is said from its code's words, and the dictionary has them in both languages", async () => {
    const { ingestErrorWords } = await import("./errors");
    const { en } = await import("@orrn/i18n/en");
    const { hi } = await import("@orrn/i18n/hi");
    const error = Object.assign(new Error("Rows of this sheet are already written. Its columns cannot change now."), { data: { code: "BAD_REQUEST" } });
    expect(ingestErrorWords(error, "action")).toEqual({ key: "ingest.error.alreadyWritten", retry: false });
    expect((en as never as { ingest: { error: { alreadyWritten: string } } }).ingest.error.alreadyWritten).toBe("Rows of this sheet are already written. Its columns cannot change now.");
    expect(typeof (hi as never as { ingest: { error: { alreadyWritten: string } } }).ingest.error.alreadyWritten).toBe("string");
  });
});

describe("the refusals of server round 8 and the fill question", () => {
  test("each refusal is said from its own words, in both languages", async () => {
    const { ingestErrorWords } = await import("./errors");
    const { en } = await import("@orrn/i18n/en");
    const { hi } = await import("@orrn/i18n/hi");
    const err = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });
    const cases: [string, string, string][] = [
      ["PRECONDITION_FAILED", "This file is being read again. Finish it, then approve.", "beingReadAgainApprove"],
      ["BAD_REQUEST", "A file is being read again. Finish it, then merge.", "beingReadAgainMerge"],
      ["BAD_REQUEST", "A sheet of this file is approved. Its tables cannot change now.", "sheetApproved"],
    ];
    for (const [code, message, key] of cases) {
      expect(ingestErrorWords(err(code, message), "action")).toEqual({ key: `ingest.error.${key}`, retry: false });
      const tree = (en as never as { ingest: { error: Record<string, string> } }).ingest.error;
      expect(tree[key]).toBe(message);
      expect(typeof (hi as never as { ingest: { error: Record<string, string> } }).ingest.error[key]).toBe("string");
    }
  });

  test("order_fill_above: one question with up to five lines, Yes and No, and the rows wait on it", async () => {
    const { questionView, rowWaitsOn, decisionOptions } = await import("./model");
    const lines = Array.from({ length: 7 }, (_, i) => ({ row: i + 2, order: String(40 + i), date: i === 0 ? null : "2024-06-01", po: "PO-A" }));
    const q = questionView({ code: "order_fill_above", subject: "", params: { count: 7 }, answer: null, open: true, lines } as never);
    expect(q.key).toBe("ingest.q.order_fill_above");
    expect(q.answers.map((a) => [a.value, a.words.key])).toEqual([[true, "common.yes"], [false, "common.no"]]);
    expect(q.fillLines).toHaveLength(5);
    expect(q.fillLines[0]).toEqual({ n: 3, order: "40", date: null, po: "PO-A" });
    expect(rowWaitsOn(["q:order_fill_above"])).toEqual({ code: "order_fill_above", subject: "" });
    expect(decisionOptions({ state: "ambiguous", options: [], mergeState: "open", reasons: ["q:order_fill_above"] }).map((o) => o.decision)).toEqual(["skip"]);
  });
});
