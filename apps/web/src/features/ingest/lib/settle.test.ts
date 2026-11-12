import { describe, expect, test } from "bun:test";

import type { IngestApi } from "./api";
import { headerAskView, type HeaderAskView, type HeaderReply } from "./header-step";
import { ReadError } from "./reader-client";
import type { EngineHints } from "./reader-engine";
import type { ReadBlock, SheetHints } from "./reader-protocol";
import { settleHeaders } from "./settle";
import { uploadOneFile, type UploadItem, type UploadReader } from "./upload";
import type { HeaderAnswer } from "./types";

/** A table of one sheet: raw header row, `n` data rows right under it, a preview of its first rows. */
function table(ordinal: number, o: { header?: number; rows?: number; sheet?: string; follows?: { block: number; gapRows: number }; hints?: EngineHints | null; tableIndex?: number; names?: string[] } = {}): ReadBlock {
  const header = o.header ?? 0;
  const rows = o.rows ?? 2;
  const names = o.names ?? ["Section", "Kg"];
  const preview = [
    { row: header, cells: names },
    ...Array.from({ length: rows }, (_, i) => ({ row: header + 1 + i, cells: [`r${ordinal}-${i}`, String(i + 1)] })),
  ];
  return {
    input: {
      ordinal, sheetName: o.sheet ?? "Sheet1", title: null, headerRow: header, headerRows: 1, headers: names,
      rowCount: rows, sample: [], preview,
    },
    rows: Array.from({ length: rows }, (_, i) => [`r${ordinal}-${i}`, String(i + 1)]),
    meta: {
      sheetName: o.sheet ?? "Sheet1", tableIndex: o.tableIndex ?? ordinal, part: 0, guess: { headerRow: header, headerRows: 1 }, hints: o.hints ?? null,
      follows: o.follows ?? null, rowBase: 0, preview, firstDataRow: header + 1, lastDataRow: header + rows, titleRows: [],
    },
  };
}

type Sent = { ordinal: number; headerRow: number; hint?: { headerRow: number; headerRows: number }; rowCount: number }[];

/** A server that keeps what it saved, fixes the block count on the first call and answers by a script. */
function server(script: (b: Sent[number], saved: boolean) => HeaderAnswer extends infer A ? Omit<Extract<A, { answer: "keep" }>, "blockId" | "by"> | Exclude<A, { answer: "keep" }> | "keep" : never) {
  const calls: Sent[] = [];
  const saved = new Set<number>();
  let count: number | null = null;
  const api = {
    artifactPutBlocks: async (input: { blocks: { ordinal: number; headerRow: number; hint?: { headerRow: number; headerRows: 1 | 2 }; rowCount: number }[] }) => {
      if (count !== null && input.blocks.length !== count) throw Object.assign(new Error("The sheets of this file are already saved"), { data: { code: "CONFLICT" } });
      count = input.blocks.length;
      calls.push(input.blocks.map((b) => ({ ordinal: b.ordinal, headerRow: b.headerRow, hint: b.hint, rowCount: b.rowCount })));
      const header: HeaderAnswer[] = [];
      for (const b of input.blocks) {
        if (saved.has(b.ordinal)) {
          header.push({ ordinal: b.ordinal, answer: "keep", by: "fit", blockId: `B${b.ordinal}` });
          continue;
        }
        const a = b.hint ? "keep" : script({ ordinal: b.ordinal, headerRow: b.headerRow, hint: b.hint, rowCount: b.rowCount }, false);
        if (a === "keep") {
          saved.add(b.ordinal);
          header.push({ ordinal: b.ordinal, answer: "keep", by: b.hint ? "person" : "fit", blockId: `B${b.ordinal}` });
        } else header.push({ ...a, ordinal: b.ordinal } as HeaderAnswer);
      }
      return { blocks: [...saved].map((o) => ({ blockId: `B${o}`, ordinal: o })), candidates: [], header };
    },
  } as unknown as Pick<IngestApi, "artifactPutBlocks">;
  return { api, calls, saved };
}

const ask = (headerRow = 0): HeaderAnswer => ({ ordinal: 0, answer: "ask", guess: { headerRow, headerRows: 1 }, candidates: [{ headerRow, headerRows: 1 }], resembles: null });

describe("settleHeaders", () => {
  test("a table whose header fits is kept and nothing is asked", async () => {
    const { api, calls } = server(() => "keep");
    const asked: HeaderAskView[] = [];
    const out = await settleHeaders({ api, artifactId: "A", blocks: [table(0), table(1)], reread: async () => [], ask: async (v) => (asked.push(v), { kind: "skip" }) });
    expect(asked).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(out.ids.get(1)).toBe("B1");
    expect(out.skipped.size).toBe(0);
  });

  test("reread: the file is read again with the row the server names, and the table is sent again with no pick of the person", async () => {
    const { api, calls } = server((b) => (b.headerRow === 0 ? { ordinal: 0, answer: "reread", headerRow: 2, headerRows: 1 } : "keep"));
    const hints: SheetHints[][] = [];
    const out = await settleHeaders({
      api, artifactId: "A", blocks: [table(0)],
      reread: async (h) => (hints.push(h), [table(0, { header: 2, hints: { headerRow: 2, headerRows: 1 } })]),
      ask: async () => ({ kind: "skip" }),
    });
    expect(hints).toEqual([[{ sheetName: "Sheet1", hints: [{ headerRow: 2, headerRows: 1 }] }]]);
    expect(calls).toHaveLength(2);
    expect(calls[1]![0]).toMatchObject({ headerRow: 2 });
    expect(calls[1]![0]!.hint).toBeUndefined();
    expect(out.blocks[0]!.input.headerRow).toBe(2);
  });

  test("ask: the person's pick is read again and sent as their hint", async () => {
    const { api, calls } = server(() => ask());
    const views: HeaderAskView[] = [];
    const out = await settleHeaders({
      api, artifactId: "A", blocks: [table(0)],
      reread: async () => [table(0, { header: 1, hints: { headerRow: 1, headerRows: 1 } })],
      ask: async (v) => (views.push(v), { kind: "pick", headerRow: 1, headerRows: 1 }),
    });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ position: 1, total: 1, hintError: false });
    expect(calls[1]![0]).toMatchObject({ headerRow: 1, hint: { headerRow: 1, headerRows: 1 } });
    expect(out.ids.get(0)).toBe("B0");
  });

  test("a pick that is the header the table was read under needs no second read", async () => {
    const { api, calls } = server(() => ask());
    let reads = 0;
    await settleHeaders({ api, artifactId: "A", blocks: [table(0)], reread: async () => (reads++, []), ask: async () => ({ kind: "pick", headerRow: 0, headerRows: 1 }) });
    expect(reads).toBe(0);
    expect(calls[1]![0]!.hint).toEqual({ headerRow: 0, headerRows: 1 });
  });

  test("a hint the reader cannot follow asks the same table again with the error, and keeps the old block", async () => {
    const { api } = server(() => ask());
    const views: HeaderAskView[] = [];
    let n = 0;
    const out = await settleHeaders({
      api, artifactId: "A", blocks: [table(0)],
      reread: async () => {
        throw new ReadError({ code: "hint_error", detail: "hint_overlap" });
      },
      ask: async (v) => {
        views.push(v);
        n += 1;
        return n === 1 ? { kind: "pick", headerRow: 2, headerRows: 1 } : { kind: "pick", headerRow: 0, headerRows: 1 };
      },
    });
    expect(views.map((v) => v.hintError)).toEqual([false, true]);
    expect(views.map((v) => v.position)).toEqual([1, 1]);
    expect(out.blocks[0]!.input.headerRow).toBe(0);
  });

  test("several tables waiting are asked one after another with a count, and a table may be skipped", async () => {
    const { api, calls } = server(() => ask());
    const views: HeaderAskView[] = [];
    const out = await settleHeaders({
      api, artifactId: "A", blocks: [table(0, { sheet: "A" }), table(1, { sheet: "B" }), table(2, { sheet: "C" })],
      reread: async () => [],
      ask: async (v) => (views.push(v), views.length === 2 ? { kind: "skip" } : { kind: "pick", headerRow: 0, headerRows: 1 }),
    });
    expect(views.map((v) => [v.position, v.total, v.sheetName])).toEqual([[1, 3, "A"], [2, 3, "B"], [3, 3, "C"]]);
    expect([...out.skipped]).toEqual([1]);
    // The skipped table goes in as an empty table under the person's own pick, so the block count never changes.
    expect(calls.at(-1)).toHaveLength(3);
    expect(calls.at(-1)![1]).toMatchObject({ rowCount: 0, hint: { headerRow: 0 } });
    expect(out.blocks[1]!.rows).toEqual([]);
  });

  test("a table that continues the one above is joined: the upper one is read to the last row of the lower, the lower stays as an empty block", async () => {
    const upper = table(0, { header: 0, rows: 2 });
    const lower = table(1, { header: 4, rows: 2, follows: { block: 0, gapRows: 2 }, names: ["PRC", "Tol"] });
    const { api, calls } = server((b) => (b.ordinal === 0 ? ask(0) : ask(4)));
    const hints: SheetHints[][] = [];
    const views: HeaderAskView[] = [];
    const out = await settleHeaders({
      api, artifactId: "A", blocks: [upper, lower],
      reread: async (h) => {
        hints.push(h);
        // The upper table now runs to the end of the lower one: one table, rows 1 to 6 (the gap rows are blank).
        const joined = table(0, { header: 0, rows: 6, hints: { headerRow: 0, headerRows: 1, lastDataRow: 6 } });
        return [joined];
      },
      ask: async (v) => {
        views.push(v);
        return v.position === 1 ? { kind: "pick", headerRow: 0, headerRows: 1 } : { kind: "continues" };
      },
    });
    expect(views[1]!.offers).toEqual(["continues"]);
    expect(hints[0]![0]!.hints[0]).toMatchObject({ headerRow: 0, lastDataRow: lower.meta!.lastDataRow });
    expect(calls.at(-1)).toHaveLength(2);
    expect(out.blocks[0]!.input.rowCount).toBe(6);
    expect([...out.skipped]).toEqual([1]);
    expect(out.blocks[1]!.rows).toEqual([]);
  });

  test("the repeated column names of a joined table are left out of its rows, and so is the title above them", async () => {
    const upper = table(0, { header: 0, rows: 2 });
    const lower = table(1, { header: 5, rows: 2, follows: { block: 0, gapRows: 2 } });
    lower.meta!.titleRows = [4];
    const { api } = server((b) => (b.ordinal === 0 ? ask(0) : ask(5)));
    const hints: SheetHints[][] = [];
    await settleHeaders({
      api, artifactId: "A", blocks: [upper, lower],
      reread: async (h) => (hints.push(h), [table(0, { rows: 7, hints: { headerRow: 0, headerRows: 1 } })]),
      ask: async (v) => (v.position === 1 ? { kind: "pick", headerRow: 0, headerRows: 1 } : { kind: "same" }),
    });
    expect(hints[0]![0]!.hints[0]!.skipRows).toEqual([4, 5]);
  });

  test("the offers are only for a table that follows another one, and 'same columns' only when it repeats the names", () => {
    const upper = table(0);
    const lower = table(1, { header: 4, follows: { block: 0, gapRows: 1 }, names: ["Section", "Kg"] });
    const q = (b: ReadBlock) => ({ key: "k", blocks: [b], guess: { headerRow: b.meta!.guess.headerRow, headerRows: 1 as const }, candidates: [], resembles: null });
    expect(headerAskView(q(lower), { position: 1, total: 1 }, { upper, hintError: false }).offers).toEqual(["continues", "same"]);
    const other = table(1, { header: 4, follows: { block: 0, gapRows: 1 }, names: ["Party", "Date"] });
    expect(headerAskView(q(other), { position: 1, total: 1 }, { upper, hintError: false }).offers).toEqual(["continues"]);
    expect(headerAskView(q(table(1, { header: 4 })), { position: 1, total: 1 }, { upper, hintError: false }).offers).toEqual([]);
  });

  test("the view draws a gap where row numbers were left out, numbers rows from 1 on the sheet, and selects the row the question names", () => {
    const b = table(0, { header: 14, rows: 2 });
    b.meta!.preview = [{ row: 0, cells: ["Title"] }, { row: 1, cells: ["Sub"] }, ...b.meta!.preview];
    b.meta!.rowBase = 2;
    const q = { key: "k", blocks: [b], guess: { headerRow: 14, headerRows: 1 as const }, candidates: [], resembles: { headerRow: 1, headerRows: 1 as const, name: "dies", target: "dies" as const, fit: "near" as const } };
    const view = headerAskView(q, { position: 1, total: 1 }, { hintError: false });
    expect(view.lines.map((l) => [l.n, l.gapBefore])).toEqual([[3, false], [4, false], [17, true], [18, false], [19, false]]);
    expect(view.preselected).toEqual({ headerRow: 1, headerRows: 1 });
    expect(view.resembles).toEqual({ name: "dies", n: 4, rows: 1 });
    const plain = headerAskView({ ...q, resembles: null }, { position: 1, total: 1 }, { hintError: false });
    expect(plain.preselected).toEqual({ headerRow: 14, headerRows: 1 });
  });
});

describe("the upload around the header step", () => {
  const fakeFetch = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  const file = new File(["PK\u0003\u0004" + "x".repeat(40)], "Orders.xlsx", { type: "" });

  function run(blocks: ReadBlock[], script: Parameters<typeof server>[0], reply: (v: HeaderAskView) => HeaderReply, reread: UploadReader["read"] | null = null) {
    const srv = server(script);
    const calls: string[] = [];
    const rows: { blockId: string; n: number }[] = [];
    const discarded: string[] = [];
    const api = {
      ...srv.api,
      artifactBegin: async () => ({ artifactId: "A1", existing: false, uploadedAt: 1, upload: null }),
      artifactCommitRaw: async () => ({}),
      artifactPutRows: async (i: { blockId: string; fromIndex: number; rows: string[][] }) => (calls.push("rows"), rows.push({ blockId: i.blockId, n: i.rows.length }), { rowsPut: i.fromIndex + i.rows.length }),
      artifactComplete: async () => (calls.push("complete"), { canonicalUploads: [] }),
      artifactGet: async () => ({ readState: "reading", vaultState: "stored", blocks: blocks.map((b) => ({ id: `B${b.input.ordinal}`, ordinal: b.input.ordinal, candidates: [{ id: `C${b.input.ordinal}`, serverSeq: 3, state: "ready" }] })) }),
      candidateDiscard: async (i: { candidateId: string }) => (discarded.push(i.candidateId), {}),
    } as unknown as IngestApi;
    const reader: UploadReader = {
      hash: async () => "a".repeat(64),
      read: reread ?? (async () => ({ kind: "sheet", blocks, rawRows: 4 })),
    };
    const items: Partial<UploadItem>[] = [];
    return {
      srv, rows, discarded, calls, items,
      go: () => uploadOneFile(file, { api, reader, fetch: fakeFetch }, { onItem: (p) => items.push(p), ask: async (v) => reply(v) }),
    };
  }

  test("rows go only after every header is settled, and only for the tables the person wants", async () => {
    const r = run([table(0, { sheet: "A" }), table(1, { sheet: "B" })], () => ask(), (v) => (v.position === 1 ? { kind: "pick", headerRow: 0, headerRows: 1 } : { kind: "skip" }));
    // Every call but the last carried no rows: the first putRows comes after the last putBlocks.
    const out = await r.go();
    expect(out.step).toBe("done");
    expect(r.rows).toEqual([{ blockId: "B0", n: 2 }]);
    expect(r.discarded).toEqual(["C1"]);
    expect(r.items.some((i) => i.step === "asking" && i.ask)).toBe(true);
    expect(r.items.at(-1)).toMatchObject({ step: "done" });
  });

  test("a file whose headers all fit is sent with no question", async () => {
    const r = run([table(0)], () => "keep", () => ({ kind: "skip" }));
    await r.go();
    expect(r.items.some((i) => i.step === "asking")).toBe(false);
    expect(r.rows).toEqual([{ blockId: "B0", n: 2 }]);
    expect(r.discarded).toEqual([]);
  });
});
