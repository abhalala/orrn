import { describe, expect, test } from "bun:test";

import { PAGE_READS_PER_PASS, finishFile, pageResultWords, runVisionPump, visionProgressWords, type VisionProgress } from "./vision-pump";
import type { VisionApi } from "./vision-api";
import type { PageSource } from "./vision-render";
import type { VisionPageView, VisionPageState, VisionStartOut } from "./vision-types";

const ARTIFACT = "art-1";

const view = (page: number, state: VisionPageState, over: Partial<VisionPageView> = {}): VisionPageView => ({
  page, state, reason: null, canRetry: false, next: state === "read" ? "done" : null, attempts: 1, blockIds: [], tables: state === "read" ? 1 : 0, ...over,
});

const ticket = (page: number, n = 1) => ({ page, url: `/files/ingest/upload?ticket=t${page}-${n}`, ticket: `t${page}-${n}`, expiresAt: Date.now() + 600_000 });

type Call = string;

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
  readPage?: (page: number, n: number) => VisionPageView | Error;
  settled?: boolean;
  complete?: () => Promise<unknown>;
};

function fakeApi(calls: Call[], script: Script = {}): VisionApi {
  let starts = 0;
  const reads = new Map<number, number>();
  const pages: VisionPageView[] = [];
  return {
    async start(input) {
      starts += 1;
      calls.push(`start:${input.pageCount}`);
      return script.start?.(starts) ?? { pageCount: input.pageCount, planned: Math.min(input.pageCount, 30), uploads: [1, 2].filter((p) => p <= input.pageCount).map((p) => ticket(p)) };
    },
    async readPage({ page }) {
      const n = (reads.get(page) ?? 0) + 1;
      reads.set(page, n);
      calls.push(`read:${page}`);
      const out = script.readPage?.(page, n) ?? view(page, "read");
      if (out instanceof Error) throw out;
      pages[page - 1] = out;
      return out;
    },
    async pages() {
      calls.push("pages");
      return { pageCount: pages.length, planned: pages.length, pages, settled: script.settled ?? true };
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
