import { describe, expect, test } from "bun:test";
import { en } from "@orrn/i18n/en";

import { openForModel, pageRanges, readRangesWords, visionBatch } from "./vision-model";
import { batchStart, runVisionPump } from "./vision-pump";
import { readVisualBytes } from "./vision-read";
import type { VisionApi } from "./vision-api";
import type { PageSource } from "./vision-render";
import { canFinishOf, type VisionPageState, type VisionPageView, type VisionPagesOut, type VisionStartOut } from "./vision-types";

/**
 * Reading a long file in batches (contract section 12): the file page's batch state ("Read next pages", the read ranges,
 * the day cap and full-file lines, Finish without the rest), and the pump's batch range: it draws and reads only the
 * pages of the batch it planned, stops at a day cap, and never completes a file with pages past the plan.
 */

const view = (page: number, state: VisionPageState, over: Partial<VisionPageView> = {}): VisionPageView => ({
  page, state, reason: null, canRetry: false, next: state === "read" || state === "typed" || state === "skipped" ? "done" : null, attempts: 1, blockIds: [], tables: state === "read" ? 1 : 0,
  bands: null, bandHeaders: null, ...over,
});
const capped = (page: number, reason: "cap_day_calls" | "cap_day_cost" = "cap_day_cost") => view(page, "not_read", { reason, canRetry: true, next: "manual" });
const out = (pages: VisionPageView[], over: Partial<VisionPagesOut> = {}): VisionPagesOut => ({
  pageCount: pages.length, planned: pages.length, pages, settled: pages.every((p) => ["read", "typed", "skipped"].includes(p.state)), full: false, restNotRead: false, ...over,
});
const range = (from: number, to: number, state: VisionPageState = "read") => Array.from({ length: to - from + 1 }, (_, i) => view(from + i, state));

describe("pages the model can still take", () => {
  test("waiting, ready and day-capped pages are open; manual, cap_page, a page to cut and settled pages are not", () => {
    expect(openForModel(view(1, "waiting"))).toBe(true);
    expect(openForModel(view(1, "ready", { next: "retry" }))).toBe(true);
    expect(openForModel(capped(1))).toBe(true);
    expect(openForModel(capped(1, "cap_day_calls"))).toBe(true);
    expect(openForModel(view(1, "not_read", { reason: "cap_page", canRetry: true }))).toBe(false);
    expect(openForModel(view(1, "not_read", { reason: "no_table" }))).toBe(false);
    expect(openForModel(view(1, "not_read", { reason: "too_many_tables" }))).toBe(false);
    expect(openForModel(view(1, "ready", { next: "band" }))).toBe(false);
    for (const s of ["read", "typed", "skipped"] as const) expect(openForModel(view(1, s))).toBe(false);
  });

  test("page ranges and their words", () => {
    expect(pageRanges([5, 1, 2, 3, 7, 8])).toEqual([[1, 3], [5, 5], [7, 8]]);
    expect(pageRanges([])).toEqual([]);
    const say = (key: string, vars?: Record<string, string | number>) => {
      const text = key.split(".").reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], en) as string;
      return text.replace(/\{(\w+)\}/g, (_, v: string) => String(vars?.[v] ?? ""));
    };
    expect(readRangesWords([[1, 12], [14, 14], [16, 30]], say)).toBe("Pages read: 1 to 12, 14, 16 to 30.");
    expect(readRangesWords([], say)).toBeNull();
  });
});

describe("the file page's batch state", () => {
  test("a batch read through with pages past the plan: Read next pages for the next batch, and Finish without the rest", () => {
    const b = visionBatch(out(range(1, 30), { pageCount: 100 }), 30);
    expect(b.readRanges).toEqual([[1, 30]]);
    expect(b.restLine).toEqual({ key: "ingest.vision.restLine", vars: { from: 31, to: 100, total: 100 } });
    expect(b.readNext).toEqual({ from: 31, to: 60, needsBytes: true, note: { key: "ingest.vision.readNextNote", vars: { from: 31, to: 60 } } });
    expect(b.finishEarly).toEqual({ label: { key: "ingest.vision.finishEarly", vars: { from: 31, to: 100 } }, note: { key: "ingest.vision.finishEarlyNote", vars: { from: 31, to: 100 } } });
    expect(b.dayCapLine).toBeNull();
    expect(b.skipRest).toBe(false);
    // The last batch stops at the file's last page.
    expect(visionBatch(out(range(1, 90), { pageCount: 100 }), 30).readNext).toMatchObject({ from: 91, to: 100 });
    // The plant's batch size decides the range.
    expect(visionBatch(out(range(1, 30), { pageCount: 100 }), 12).readNext).toMatchObject({ from: 31, to: 42 });
  });

  test("a day cap mid-batch: the capped page is named and Read next pages carries on from it with the images stored", () => {
    const pages = [...range(1, 3), capped(4), ...range(5, 6, "ready")];
    const b = visionBatch(out(pages, { pageCount: 10, settled: false }), 6);
    expect(b.dayCapLine).toEqual({ key: "ingest.vision.dayCostLine", vars: { page: 4 } });
    expect(b.readNext).toEqual({ from: 4, to: 6, needsBytes: false, note: { key: "ingest.vision.readNextNote", vars: { from: 4, to: 6 } } });
    expect(b.finishEarly).toBeNull();
    expect(visionBatch(out([...range(1, 2), capped(3, "cap_day_calls")], { settled: false }), 3).dayCapLine).toEqual({ key: "ingest.vision.dayCallsLine", vars: { page: 3 } });
    // A capped page next to a page with no image yet needs the bytes again.
    expect(visionBatch(out([capped(1), view(2, "waiting")], { settled: false }), 2).readNext).toMatchObject({ needsBytes: true });
  });

  test("pages still due and no cap: Carry on reading stays, Read next pages waits", () => {
    expect(visionBatch(out([view(1, "read"), view(2, "ready")], { pageCount: 9, settled: false }), 2).readNext).toBeNull();
  });

  test("a page only a person can settle does not hold the next batch", () => {
    const pages = [view(1, "read"), view(2, "not_read", { reason: "no_table", next: "manual" })];
    const b = visionBatch(out(pages, { pageCount: 5, settled: false }), 2);
    expect(b.readNext).toMatchObject({ from: 3, to: 4 });
    expect(b.finishEarly).toBeNull();
  });

  test("a full file: the full line, no next batch, and Skip the rest and finish while pages are open", () => {
    const pages = [...range(1, 10), view(11, "not_read", { reason: "too_many_tables", next: "manual" })];
    const b = visionBatch(out(pages, { pageCount: 40, full: true, settled: false }), 12);
    expect(b.fullLine).toEqual({ key: "ingest.vision.fullLine", vars: { max: 50 } });
    expect(b.readNext).toBeNull();
    expect(b.skipRest).toBe(true);
    // Every planned page settled: Finish without the rest.
    expect(visionBatch(out(range(1, 10), { pageCount: 40, full: true }), 12)).toMatchObject({ skipRest: false, readNext: null, finishEarly: { label: { vars: { from: 11, to: 40 } } } });
  });

  test("every page planned, or the rest left on purpose: plain Finish, nothing more to read", () => {
    const all = visionBatch(out(range(1, 5)), 30);
    expect(all).toMatchObject({ readNext: null, finishEarly: null, restLine: null });
    const left = out(range(1, 5), { pageCount: 9, restNotRead: true, canFinish: true });
    expect(visionBatch(left, 30)).toMatchObject({ readNext: { from: 6, to: 9 }, finishEarly: null, restLine: null });
    expect(canFinishOf(left)).toBe(true);
    expect(canFinishOf(out(range(1, 5), { pageCount: 9 }))).toBe(false);
    expect(canFinishOf(out(range(1, 5)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The pump's batch range
// ---------------------------------------------------------------------------

const ticket = (page: number) => ({ page, url: `/files/ingest/upload?ticket=t${page}`, ticket: `t${page}`, expiresAt: Date.now() + 600_000 });

function source(pageCount: number, calls: string[]): PageSource {
  return {
    pageCount,
    async render(page) {
      calls.push(`render:${page}`);
      return new Blob([`page ${page}`], { type: "image/jpeg" });
    },
    close() {},
  };
}

const fetchOk = (calls: string[]) =>
  (async (input: RequestInfo | URL) => {
    calls.push(`put:${new URL(String(input), "http://x").searchParams.get("ticket")}`);
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;

/** A server of `pageCount` pages planned to `planned`, with pages 1..`readTo` read; `nextBatch` plans `batch` more. */
function server(calls: string[], o: { pageCount: number; planned: number; readTo: number; batch: number; cap?: number; open?: VisionPageView[] }) {
  const state = new Map<number, VisionPageView>();
  for (let p = 1; p <= o.readTo; p++) state.set(p, view(p, "read"));
  for (const v of o.open ?? []) state.set(v.page, v);
  let planned = o.planned;
  const pagesOut = (): VisionPagesOut => {
    const pages = Array.from({ length: planned }, (_, i) => state.get(i + 1) ?? view(i + 1, "ready"));
    const settled = pages.every((p) => p.state === "read");
    return { pageCount: o.pageCount, planned, pages, settled, full: false, restNotRead: false, canFinish: settled && planned >= o.pageCount };
  };
  const api = {
    async start(): Promise<VisionStartOut> {
      calls.push("start");
      return { pageCount: o.pageCount, planned, uploads: [], texts: [] };
    },
    async nextBatch(): Promise<VisionStartOut> {
      const from = planned + 1;
      planned = Math.min(o.pageCount, planned + o.batch);
      calls.push(`nextBatch:${from}-${planned}`);
      return { pageCount: o.pageCount, planned, uploads: Array.from({ length: planned - from + 1 }, (_, i) => ticket(from + i)), texts: [] };
    },
    async pages() {
      calls.push("pages");
      return pagesOut();
    },
    async readPage({ page }: { page: number }) {
      calls.push(`read:${page}`);
      const v = o.cap !== undefined && page >= o.cap ? capped(page) : view(page, "read");
      state.set(page, v);
      return v;
    },
    async complete() {
      calls.push("complete");
      return {};
    },
  } as unknown as VisionApi;
  return api;
}

describe("the pump in batches", () => {
  test("Read next pages plans the next batch, draws and reads only its pages, and leaves the file open", async () => {
    const calls: string[] = [];
    const api = server(calls, { pageCount: 100, planned: 30, readTo: 30, batch: 30 });
    const res = await runVisionPump("a1", source(100, calls), { api: batchStart(api, "a1"), fetch: fetchOk(calls) });
    expect(calls.slice(0, 3)).toEqual(["start", "pages", "nextBatch:31-60"]);
    expect(calls.filter((c) => c.startsWith("render:"))).toEqual(Array.from({ length: 30 }, (_, i) => `render:${31 + i}`));
    expect(calls.filter((c) => c.startsWith("read:"))).toEqual(Array.from({ length: 30 }, (_, i) => `read:${31 + i}`));
    expect(calls).not.toContain("complete");
    expect(res).toMatchObject({ settled: true, completed: false });
  });

  test("the last batch completes the file", async () => {
    const calls: string[] = [];
    const api = server(calls, { pageCount: 40, planned: 30, readTo: 30, batch: 30 });
    const res = await runVisionPump("a1", source(40, calls), { api: batchStart(api, "a1"), fetch: fetchOk(calls) });
    expect(calls).toContain("nextBatch:31-40");
    expect(calls.at(-1)).toBe("complete");
    expect(res).toMatchObject({ completed: true });
  });

  test("a day cap stops the pass at the capped page; Read next pages the next day starts there and plans nothing", async () => {
    const calls: string[] = [];
    const api = server(calls, { pageCount: 10, planned: 6, readTo: 0, batch: 4, cap: 4 });
    const first = await runVisionPump("a1", source(10, calls), { api, fetch: fetchOk(calls) });
    expect(calls.filter((c) => c.startsWith("read:"))).toEqual(["read:1", "read:2", "read:3", "read:4"]);
    expect(first).toMatchObject({ dayCapped: true, completed: false });

    calls.length = 0;
    const nextDay = server(calls, { pageCount: 10, planned: 6, readTo: 3, batch: 4, open: [capped(4)] });
    await runVisionPump("a1", source(10, calls), { api: batchStart(nextDay, "a1"), fetch: fetchOk(calls) });
    expect(calls.some((c) => c.startsWith("nextBatch"))).toBe(false);
    expect(calls.filter((c) => c.startsWith("read:"))).toEqual(["read:4", "read:5", "read:6"]);
    expect(calls.filter((c) => c.startsWith("render:"))).toEqual([]);
  });

  test("a page waiting to be cut is read first: Read next pages cuts it and plans no batch", async () => {
    const calls: string[] = [];
    const api = server(calls, { pageCount: 10, planned: 6, readTo: 6, batch: 4, open: [view(4, "ready", { next: "band" })] });
    const bandApi = {
      ...api,
      async readPage({ page, band }: { page: number; band?: number }) {
        calls.push(band ? `read:${page}:b${band}` : `read:${page}`);
        return band ? view(page, "read") : view(page, "ready", { next: "band" });
      },
      async bandTickets({ page, bands }: { page: number; bands: number }) {
        calls.push(`bands:${page}:${bands}`);
        return { page, total: bands, uploads: Array.from({ length: bands }, (_, i) => ({ band: i + 1, url: `/u?ticket=p${page}b${i + 1}`, ticket: "t", expiresAt: 0 })) };
      },
    } as unknown as VisionApi;
    const src: PageSource = { ...source(10, calls), bands: async (page) => (calls.push(`cut:${page}`), [new Blob(["a"]), new Blob(["b"])]) };
    await runVisionPump("a1", src, { api: batchStart(bandApi, "a1"), fetch: fetchOk(calls) });
    expect(calls.some((c) => c.startsWith("nextBatch"))).toBe(false);
    expect(calls).toContain("cut:4");
    expect(calls).toContain("read:4:b1");
    expect(calls.filter((c) => /^read:\d+$/.test(c))[0]).toBe("read:4");
  });

  test("the panel waits for the cut before offering the next batch", () => {
    const pages = [...range(1, 3), view(4, "ready", { next: "band" })];
    expect(visionBatch(out(pages, { pageCount: 10, settled: false }), 4).readNext).toBeNull();
  });

  test("the upload strip counts pages past the plan as not read", async () => {
    const calls: string[] = [];
    const api = server(calls, { pageCount: 45, planned: 30, readTo: 0, batch: 30 });
    const res = await readVisualBytes({ api, artifactId: "a1", file: new Blob(["x"]), kind: "pdf_scan", open: async () => source(45, calls) });
    expect(res).toMatchObject({ kind: "left", open: 15 });
  });
});
