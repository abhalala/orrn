import { describe, expect, test } from "bun:test";

import { PAGE_READS_PER_PASS, finishFile, runVisionPump, type VisionProgress } from "./vision-pump";
import { pageResultWords, visionProgressWords } from "./vision-words";
import type { VisionApi } from "./vision-api";
import type { PageSource } from "./vision-render";
import type { VisionBandTicketsOut, VisionPageView, VisionPageState, VisionStartOut } from "./vision-types";

const ARTIFACT = "art-1";

const view = (page: number, state: VisionPageState, over: Partial<VisionPageView> = {}): VisionPageView => ({
  page, state, reason: null, canRetry: false, next: state === "read" ? "done" : null, attempts: 1, blockIds: [], tables: state === "read" ? 1 : 0,
  bands: null, bandHeaders: null, ...over,
});

const ticket = (page: number, n = 1) => ({ page, url: `/files/ingest/upload?ticket=t${page}-${n}`, ticket: `t${page}-${n}`, expiresAt: Date.now() + 600_000 });

type Call = string;

const bandTicket = (page: number, band: number, n = 1) => ({ band, url: `/files/ingest/upload?ticket=p${page}b${band}-${n}`, ticket: `p${page}b${band}-${n}`, expiresAt: Date.now() + 600_000 });

function fakeSource(pageCount: number, calls: Call[]): PageSource {
  return {
    pageCount,
    async render(page) {
      calls.push(`render:${page}`);
      return new Blob([`page ${page}`], { type: "image/jpeg" });
    },
    close() {},
  };
}

type Script = {
  start?: (n: number) => VisionStartOut;
  readPage?: (page: number, n: number, band?: number) => VisionPageView | Error;
  bandTickets?: (page: number, bands: number, n: number) => VisionBandTicketsOut | Error;
  pagesView?: () => VisionPageView[];
  /** The plan `pages` answers (default: one page per view, all planned). */
  plan?: () => { pageCount: number; planned: number; full?: boolean; canFinish?: boolean };
  nextBatch?: () => VisionStartOut;
  settled?: boolean;
  complete?: () => Promise<unknown>;
};

function fakeApi(calls: Call[], script: Script = {}): VisionApi {
  let starts = 0;
  const reads = new Map<number, number>();
  const bandCalls = new Map<number, number>();
  const pages: VisionPageView[] = [];
  return {
    async start(input) {
      starts += 1;
      calls.push(`start:${input.pageCount}`);
      return script.start?.(starts) ?? { pageCount: input.pageCount, planned: Math.min(input.pageCount, 30), uploads: [1, 2].filter((p) => p <= input.pageCount).map((p) => ticket(p)) };
    },
    async nextBatch() {
      calls.push("nextBatch");
      return script.nextBatch?.() ?? { pageCount: 0, planned: 0, uploads: [], texts: [] };
    },
    async finishRest() {
      throw new Error("not used");
    },
    async readPage({ page, band }) {
      const n = (reads.get(page) ?? 0) + 1;
      reads.set(page, n);
      calls.push(band ? `read:${page}:b${band}` : `read:${page}`);
      const out = script.readPage?.(page, n, band) ?? view(page, "read");
      if (out instanceof Error) throw out;
      pages[page - 1] = out;
      return out;
    },
    async bandTickets({ page, bands }) {
      const n = (bandCalls.get(page) ?? 0) + 1;
      bandCalls.set(page, n);
      calls.push(`bands:${page}:${bands}`);
      const out = script.bandTickets?.(page, bands, n) ?? { page, total: bands, uploads: Array.from({ length: bands }, (_, i) => bandTicket(page, i + 1, n)) };
      if (out instanceof Error) throw out;
      return out;
    },
    async pages() {
      calls.push("pages");
      const list = script.pagesView?.() ?? pages;
      return { pageCount: list.length, planned: list.length, pages: list, settled: script.settled ?? true, ...script.plan?.() };
    },
    async skipPage({ page }) {
      return view(page, "skipped");
    },
    async typePage({ page }) {
      return view(page, "typed");
    },
    async readUrl() {
      return { url: "/x", expiresAt: 0 };
    },
    async check() {
      throw new Error("not used");
    },
    async fixCell() {
      throw new Error("not used");
    },
    async complete() {
      calls.push("complete");
      return script.complete ? script.complete() : { canonicalUploads: [] };
    },
  };
}

function fakeFetch(calls: Call[], status: (url: string) => number = () => 200): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const t = new URL(url).searchParams.get("ticket");
    calls.push(`put:${t}:${(init?.headers as Record<string, string>)["content-type"]}`);
    return new Response(null, { status: status(url) });
  }) as unknown as typeof fetch;
}

const trpcError = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });

describe("vision pump", () => {
  test("start, then every page rendered and sent, then read page by page, then complete", async () => {
    const calls: Call[] = [];
    const seen: VisionProgress[] = [];
    const out = await runVisionPump(ARTIFACT, fakeSource(2, calls), { api: fakeApi(calls), fetch: fakeFetch(calls), onProgress: (p) => seen.push(p) });
    expect(calls).toEqual([
      "start:2",
      "render:1", "put:t1-1:image/jpeg",
      "render:2", "put:t2-1:image/jpeg",
      "read:1", "read:2",
      "pages", "complete",
    ]);
    expect(out).toMatchObject({ settled: true, completed: true });
    expect(seen.filter((p) => p.phase === "page").map((p) => (p as { page: number }).page)).toEqual([1, 2]);
    expect(seen.at(-1)).toEqual({ phase: "finishing" });
  });

  test("the file's whole page count goes to start, even past the cap", async () => {
    const calls: Call[] = [];
    await runVisionPump(ARTIFACT, fakeSource(45, calls), {
      api: fakeApi(calls, { start: () => ({ pageCount: 45, planned: 30, uploads: [] }) }),
      fetch: fakeFetch(calls),
    });
    expect(calls[0]).toBe("start:45");
    expect(calls.filter((c) => c.startsWith("read:"))).toHaveLength(30);
  });

  test("a page whose answer says retry is read again, up to the per-page limit, then the pump moves on", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, {
      readPage: (page, n) => (page === 1 && n < 3 ? view(1, "ready", { next: "retry" }) : page === 2 ? view(2, "ready", { next: "retry" }) : view(page, "read")),
      settled: false,
    });
    const out = await runVisionPump(ARTIFACT, fakeSource(2, calls), { api, fetch: fakeFetch(calls) });
    expect(calls.filter((c) => c === "read:1")).toHaveLength(3);
    expect(calls.filter((c) => c === "read:2")).toHaveLength(PAGE_READS_PER_PASS);
    expect(out).toMatchObject({ settled: false, completed: false });
    expect(calls).not.toContain("complete");
  });

  test("a page that is not read stops nothing: the next page is read and the file is not completed", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, { readPage: (page) => (page === 1 ? view(1, "not_read", { reason: "no_table", next: "manual" }) : view(page, "read")), settled: false });
    const out = await runVisionPump(ARTIFACT, fakeSource(2, calls), { api, fetch: fakeFetch(calls) });
    expect(calls.filter((c) => c.startsWith("read:"))).toEqual(["read:1", "read:2"]);
    expect(out.settled).toBe(false);
    expect(calls).not.toContain("complete");
  });

  test("an expired ticket (403) asks start again and sends the rest with the fresh tickets", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, {
      start: (n) => ({ pageCount: 2, planned: 2, uploads: n === 1 ? [ticket(1), ticket(2)] : [ticket(2, 2)] }),
    });
    const fetch = fakeFetch(calls, (url) => (url.includes("t2-1") ? 403 : 200));
    await runVisionPump(ARTIFACT, fakeSource(2, calls), { api, fetch });
    expect(calls.slice(0, 7)).toEqual(["start:2", "render:1", "put:t1-1:image/jpeg", "render:2", "put:t2-1:image/jpeg", "start:2", "render:2"]);
    expect(calls).toContain("put:t2-2:image/jpeg");
  });

  test("a page already stored (409) counts as sent", async () => {
    const calls: Call[] = [];
    const out = await runVisionPump(ARTIFACT, fakeSource(2, calls), { api: fakeApi(calls), fetch: fakeFetch(calls, () => 409) });
    expect(calls.filter((c) => c.startsWith("start"))).toHaveLength(1);
    expect(out.completed).toBe(true);
  });

  test("another failed PUT stops the pass", async () => {
    const calls: Call[] = [];
    await expect(runVisionPump(ARTIFACT, fakeSource(2, calls), { api: fakeApi(calls), fetch: fakeFetch(calls, () => 500) })).rejects.toThrow("upload failed (500)");
  });

  test("Upload this page first: the page is sent again, then read", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, {
      start: (n) => ({ pageCount: 2, planned: 2, uploads: n === 1 ? [] : [ticket(2, 2)] }),
      readPage: (page, n) => (page === 2 && n === 1 ? trpcError("BAD_REQUEST", "Upload this page first") : view(page, "read")),
    });
    await runVisionPump(ARTIFACT, fakeSource(2, calls), { api, fetch: fakeFetch(calls) });
    expect(calls).toEqual(["start:2", "read:1", "read:2", "start:2", "render:2", "put:t2-2:image/jpeg", "read:2", "pages", "complete"]);
  });

  test("a resumed file with every image stored sends nothing and reads what is left", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, { start: () => ({ pageCount: 2, planned: 2, uploads: [] }) });
    await runVisionPump(ARTIFACT, fakeSource(2, calls), { api, fetch: fakeFetch(calls) });
    expect(calls.filter((c) => c.startsWith("render") || c.startsWith("put"))).toEqual([]);
  });

  test("a cancelled pass stops before the next step", async () => {
    const calls: Call[] = [];
    const ctl = new AbortController();
    ctl.abort();
    await expect(runVisionPump(ARTIFACT, fakeSource(2, calls), { api: fakeApi(calls), fetch: fakeFetch(calls), signal: ctl.signal })).rejects.toThrow("Cancelled");
    expect(calls).toEqual([]);
  });

  test("a refusal from the server is not swallowed", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, { readPage: () => trpcError("BAD_REQUEST", "This file is not being read page by page") });
    await expect(runVisionPump(ARTIFACT, fakeSource(1, calls), { api, fetch: fakeFetch(calls) })).rejects.toThrow("not being read page by page");
  });

  test("finishing a file another tab finished counts as finished", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, { complete: () => Promise.reject(trpcError("BAD_REQUEST", "This file is already read")) });
    expect(await finishFile(api, ARTIFACT)).toBe(true);
    const failing = fakeApi(calls, { complete: () => Promise.reject(trpcError("BAD_REQUEST", "Some pages are not read yet. Read, type or skip each page first.")) });
    await expect(finishFile(failing, ARTIFACT)).rejects.toThrow("Some pages");
  });

  test("progress words: one sentence per step, a page's answer by its state", () => {
    expect(visionProgressWords({ phase: "reading", page: 2, total: 5 })).toEqual({ key: "ingest.vision.reading", vars: { page: 2, total: 5 } });
    expect(pageResultWords(view(2, "read", { tables: 2 }), 5)).toEqual({ key: "ingest.vision.pageRead", vars: { page: 2, total: 5, count: 2 } });
    expect(pageResultWords(view(3, "not_read"), 5)).toEqual({ key: "ingest.vision.pageNotRead", vars: { page: 3, total: 5 } });
    expect(pageResultWords(view(4, "skipped"), 5).key).toBe("ingest.vision.pageSkipped");
  });
});

describe("vision pump: page text for the digit check (section 11.5)", () => {
  const textTicket = (page: number, n = 1) => ({ page, url: `/files/ingest/upload?ticket=x${page}-${n}`, ticket: `x${page}-${n}`, expiresAt: Date.now() + 600_000 });
  const withText = (calls: Call[], texts: Record<number, string | null>): PageSource => ({
    ...fakeSource(2, calls),
    async text(page) {
      calls.push(`text:${page}`);
      return texts[page] ?? null;
    },
  });

  test("a text PDF sends each page's text as JSON after the images and before any page is read", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, { start: () => ({ pageCount: 2, planned: 2, uploads: [ticket(1), ticket(2)], texts: [textTicket(1), textTicket(2)] }) });
    await runVisionPump(ARTIFACT, withText(calls, { 1: '{"v":1,"items":["R100"]}', 2: '{"v":1,"items":["9"]}' }), { api, fetch: fakeFetch(calls) });
    const firstRead = calls.indexOf("read:1");
    expect(calls.indexOf("put:x1-1:application/json")).toBeGreaterThan(calls.indexOf("put:t2-1:image/jpeg"));
    expect(calls.indexOf("put:x1-1:application/json")).toBeLessThan(firstRead);
    expect(calls.indexOf("put:x2-1:application/json")).toBeLessThan(firstRead);
  });

  test("a page with no text (or text over the cap) sends nothing; a failed text never stops the read", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, { start: () => ({ pageCount: 2, planned: 2, uploads: [], texts: [textTicket(1), textTicket(2)] }) });
    const out = await runVisionPump(ARTIFACT, withText(calls, { 1: null, 2: '{"v":1,"items":["9"]}' }), { api, fetch: fakeFetch(calls, (u) => (u.includes("x2") ? 500 : 200)) });
    expect(calls.some((c) => c.startsWith("put:x1"))).toBe(false);
    expect(calls).toContain("put:x2-1:application/json");
    expect(calls).toContain("read:2");
    expect(out.completed).toBe(true);
  });

  test("a stale text ticket asks for fresh tickets once", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, { start: (n) => ({ pageCount: 1, planned: 1, uploads: [], texts: [textTicket(1, n)] }) });
    await runVisionPump(ARTIFACT, { ...withText(calls, { 1: '{"v":1,"items":["1"]}' }), pageCount: 1 }, { api, fetch: fakeFetch(calls, (u) => (u.includes("x1-1") ? 403 : 200)) });
    expect(calls.filter((c) => c.startsWith("start:")).length).toBe(2);
    expect(calls).toContain("put:x1-2:application/json");
  });
});

describe("vision pump: dense pages in bands (section 11.3)", () => {
  const blobs = (k: number) => Array.from({ length: k }, (_, i) => new Blob([`band ${i + 1}`], { type: "image/jpeg" }));
  const banded = (calls: Call[], pageCount: number, cut: Partial<Record<"text" | "ink", number | null>>): PageSource => ({
    ...fakeSource(pageCount, calls),
    async bands(page, how) {
      calls.push(`cut:${page}:${how}`);
      const k = cut[how];
      return k ? blobs(k) : null;
    },
  });
  const one = (pages: number[]) => () => ({ pageCount: pages.length, planned: pages.length, uploads: pages.map((p) => ticket(p)) });

  test("a scan answered next band is cut on blank rows, its bands sent, band 1 read first, then the rest", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, {
      start: one([1]),
      readPage: (_p, n, band) => {
        if (n === 1) return view(1, "ready", { next: "band", bandHeaders: ["Code"] });
        if (band === 1) return view(1, "ready", { next: "retry", bands: { total: 3, read: 1, next: 2 } });
        if (n === 3) return view(1, "ready", { next: "retry", bands: { total: 3, read: 2, next: 3 } });
        return view(1, "read", { bands: null });
      },
    });
    const out = await runVisionPump(ARTIFACT, banded(calls, 1, { ink: 3 }), { api, fetch: fakeFetch(calls) });
    expect(out.completed).toBe(true);
    const at = (c: string) => calls.indexOf(c);
    expect(calls).toContain("cut:1:text");
    expect(at("cut:1:ink")).toBeGreaterThan(at("read:1"));
    expect(at("bands:1:3")).toBeGreaterThan(at("cut:1:ink"));
    for (const k of [1, 2, 3]) expect(at(`put:p1b${k}-1:image/jpeg`)).toBeGreaterThan(at("bands:1:3"));
    expect(at("read:1:b1")).toBeGreaterThan(at("put:p1b3-1:image/jpeg"));
    expect(calls.filter((c) => c.startsWith("read:1")).length).toBe(4);
  });

  test("a scan the browser cannot cut stays as it is (Type and Skip on the file page), and the pass goes on", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, { start: one([1, 2]), readPage: (p) => (p === 1 ? view(1, "ready", { next: "band" }) : view(2, "read")), settled: false });
    const out = await runVisionPump(ARTIFACT, banded(calls, 2, { ink: null }), { api, fetch: fakeFetch(calls) });
    expect(calls.filter((c) => c === "read:1").length).toBe(1);
    expect(calls.some((c) => c.startsWith("bands:"))).toBe(false);
    expect(calls).toContain("read:2");
    expect(out.settled).toBe(false);
  });

  test("a dense text PDF page goes as bands, counted from the text layer before any call, and its whole image too", async () => {
    const calls: Call[] = [];
    const api = fakeApi(calls, { start: one([1]), readPage: () => view(1, "read") });
    await runVisionPump(ARTIFACT, banded(calls, 1, { text: 2 }), { api, fetch: fakeFetch(calls) });
    const at = (c: string) => calls.indexOf(c);
    expect(at("bands:1:2")).toBeGreaterThan(at("cut:1:text"));
    expect(at("put:p1b2-1:image/jpeg")).toBeLessThan(at("read:1"));
    expect(calls).toContain("put:t1-1:image/jpeg");
    expect(at("bands:1:2")).toBeLessThan(at("put:t1-1:image/jpeg"));
  });

  test("a stale band ticket asks for the missing ones again; a band image the server lacks is sent again once", async () => {
    const calls: Call[] = [];
    let reads = 0;
    const api = fakeApi(calls, {
      // Once the page is cut into bands, vision.start hands no whole-page ticket for it.
      start: (n) => ({ pageCount: 1, planned: 1, uploads: n === 1 ? [ticket(1)] : [] }),
      bandTickets: (page, bands, n) => ({ page, total: bands, uploads: n === 1 ? [bandTicket(1, 1, 1), bandTicket(1, 2, 1)] : [bandTicket(1, 2, n)] }),
      readPage: () => {
        reads += 1;
        if (reads === 1) return trpcErrorObj("BAD_REQUEST", "Upload this page first");
        return view(1, "read");
      },
      pagesView: () => [view(1, "ready", { bands: { total: 2, read: 0, next: 1 } })],
    });
    await runVisionPump(ARTIFACT, banded(calls, 1, { text: 2 }), { api, fetch: fakeFetch(calls, (u) => (u.includes("p1b2-1") ? 403 : 200)) });
    expect(calls).toContain("put:p1b2-2:image/jpeg");
    // The missing band went again after the server said so, with the same count, and no whole page went again.
    expect(calls.filter((c) => c === "bands:1:2").length).toBe(3);
    expect(calls.indexOf("pages")).toBeLessThan(calls.lastIndexOf("bands:1:2"));
    expect(calls.filter((c) => c.startsWith("put:t1")).length).toBe(1);
    expect(calls.filter((c) => c === "read:1").length).toBe(2);
  });

  test("the read of one band is worded with its part", () => {
    expect(visionProgressWords({ phase: "reading", page: 2, total: 5, band: { index: 1, total: 3 } })).toEqual({
      key: "ingest.vision.readingBand",
      vars: { page: 2, total: 5, band: 1, bands: 3 },
    });
    expect(visionProgressWords({ phase: "cutting", page: 2, total: 5 })).toEqual({ key: "ingest.vision.cutting", vars: { page: 2, total: 5 } });
  });
});

function trpcErrorObj(code: string, message: string): Error {
  return Object.assign(new Error(message), { data: { code } });
}
