import { describe, expect, test } from "bun:test";

import type { IngestApi } from "./api";
import { DEFAULT_LIMITS } from "./limits";
import { ReadError } from "./reader-client";
import type { ReadBlock } from "./reader-protocol";
import { gzipJsonl, problemFromError, ticketUrl, uploadOneFile, type UploadItem, type UploadReader } from "./upload";

const block = (ordinal: number, rows: number, extra: Partial<ReadBlock["input"]> = {}): ReadBlock => ({
  input: {
    ordinal, sheetName: `S${ordinal}`, title: null, headerRow: 0, headerRows: 1, headers: ["a", "b"], rowCount: rows,
    sample: [], ...extra,
  },
  rows: Array.from({ length: rows }, (_, i) => [`r${ordinal}-${i}`, "x"]),
});

type Call = { name: string; input: unknown };

function fakeApi(over: Partial<Record<keyof IngestApi, unknown>> = {}) {
  const calls: Call[] = [];
  const rec = (name: string, fn: (input: never) => unknown) => async (input: never) => {
    calls.push({ name, input });
    return fn(input);
  };
  const api = {
    artifactBegin: rec("begin", () => ({
      artifactId: "A1", existing: false, uploadedAt: 1_700_000_000_000,
      upload: { url: "https://api.test/files/ingest/upload", ticket: "T1", expiresAt: 1 },
    })),
    artifactCommitRaw: rec("commitRaw", () => ({ vaultState: "stored" })),
    artifactPutBlocks: rec("putBlocks", (i: { blocks: { ordinal: number }[] }) => ({
      blocks: i.blocks.map((b) => ({ blockId: `B${b.ordinal}`, ordinal: b.ordinal })), candidates: [],
    })),
    artifactPutRows: rec("putRows", (i: { fromIndex: number; rows: string[][] }) => ({ rowsPut: i.fromIndex + i.rows.length })),
    artifactComplete: rec("complete", () => ({ canonicalUploads: [{ blockOrdinal: 0, url: "https://api.test/files/ingest/upload?x=1", ticket: "C0" }] })),
    artifactGet: rec("get", () => ({ readState: "reading", vaultState: "stored", blocks: [] })),
    ...over,
  } as unknown as IngestApi;
  return { api, calls };
}

function fakeFetch() {
  const puts: { url: string; type: string; size: number; body: Blob }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const body = init.body as Blob;
    puts.push({ url, type: String((init.headers as Record<string, string>)["content-type"]), size: body.size, body });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, puts };
}

const reader = (blocks: ReadBlock[], over: Partial<UploadReader> = {}): UploadReader => ({
  hash: async () => "a".repeat(64),
  read: async () => ({ kind: "sheet", blocks, rawRows: blocks.reduce((n, b) => n + b.rows.length, 0) }),
  ...over,
});

const file = (name = "Baki Oct-25.xlsx", bytes = 100) => new File([new Uint8Array(bytes)], name, { type: "" });

function track() {
  const steps: string[] = [];
  let item: Partial<UploadItem> = {};
  return {
    steps,
    get item() {
      return item;
    },
    onItem: (p: Partial<UploadItem>) => {
      item = { ...item, ...p };
      if (p.step && steps[steps.length - 1] !== p.step) steps.push(p.step);
    },
  };
}

describe("uploadOneFile", () => {
  test("a new file goes hash, begin, raw PUT, commit, blocks, rows, complete, canonical PUT, in that order", async () => {
    const { api, calls } = fakeApi();
    const { fn, puts } = fakeFetch();
    const t = track();
    const out = await uploadOneFile(file(), { api, reader: reader([block(0, 3)]), fetch: fn }, { onItem: t.onItem });
    expect(out).toEqual({ artifactId: "A1", step: "done" });
    expect(calls.map((c) => c.name)).toEqual(["begin", "commitRaw", "putBlocks", "putRows", "complete"]);
    expect(t.steps).toEqual(["hashing", "saving", "reading", "sending", "done"]);
    expect(calls[0]!.input).toMatchObject({ sha256: "a".repeat(64), fileName: "Baki Oct-25.xlsx", kind: "sheet", contentType: null });
    // raw PUT first with the ticket in the URL, then the canonical gzip
    expect(puts).toHaveLength(2);
    expect(puts[0]!.url).toBe("https://api.test/files/ingest/upload?ticket=T1");
    expect(puts[0]!.size).toBe(100);
    expect(puts[1]!.url).toContain("ticket=C0");
    expect(puts[1]!.type).toBe("application/gzip");
  });

  test("the canonical file is gzip of one JSON array per line", async () => {
    const blob = await gzipJsonl([["a", "b"], ["c,d", "e\"f"]]);
    const text = await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
    expect(text.trim().split("\n").map((l) => JSON.parse(l))).toEqual([["a", "b"], ["c,d", "e\"f"]]);
    expect(blob.size).toBeGreaterThan(0);
  });

  test("rows go 500 at a time, each with the count the server already holds", async () => {
    const { api, calls } = fakeApi();
    await uploadOneFile(file(), { api, reader: reader([block(0, 1201)]), fetch: fakeFetch().fn }, { onItem: () => undefined });
    const rows = calls.filter((c) => c.name === "putRows").map((c) => c.input as { blockId: string; fromIndex: number; expectRowsPut: number; rows: unknown[] });
    expect(rows.map((r) => [r.blockId, r.fromIndex, r.expectRowsPut, r.rows.length])).toEqual([
      ["B0", 0, 0, 500], ["B0", 500, 500, 500], ["B0", 1000, 1000, 201],
    ]);
  });

  test("blocks go 50 to a call and every block's rows follow", async () => {
    const { api, calls } = fakeApi();
    const blocks = Array.from({ length: 50 }, (_, i) => block(i, 2));
    await uploadOneFile(file(), { api, reader: reader(blocks), fetch: fakeFetch().fn }, { onItem: () => undefined });
    const put = calls.filter((c) => c.name === "putBlocks");
    expect(put).toHaveLength(1);
    expect((put[0]!.input as { blocks: unknown[] }).blocks).toHaveLength(50);
    expect(calls.filter((c) => c.name === "putRows")).toHaveLength(50);
  });

  test("sent counts climb to the total", async () => {
    const { api } = fakeApi();
    const t = track();
    await uploadOneFile(file(), { api, reader: reader([block(0, 700), block(1, 10)]), fetch: fakeFetch().fn }, { onItem: t.onItem });
    expect(t.item.sent).toEqual({ rows: 710, total: 710 });
  });

  test("no storage: no ticket, nothing PUT but the canonical rows, and the item says not stored", async () => {
    const { api, calls } = fakeApi({
      artifactBegin: async () => ({ artifactId: "A1", existing: false, uploadedAt: 1, upload: null }),
    });
    const { fn, puts } = fakeFetch();
    const t = track();
    await uploadOneFile(file(), { api, reader: reader([block(0, 3)]), fetch: fn }, { onItem: t.onItem });
    expect(calls.map((c) => c.name)).not.toContain("commitRaw");
    expect(puts).toHaveLength(1);
    expect(t.item.notStored).toBe(true);
    expect(t.steps).not.toContain("saving");
  });

  test("the same file again opens the artifact and sends nothing", async () => {
    const { api, calls } = fakeApi({
      artifactBegin: async () => ({ artifactId: "A1", existing: true, uploadedAt: 1_700_000_000_000, upload: null }),
      artifactGet: async () => ({ readState: "read", vaultState: "stored", blocks: [{ id: "B0", ordinal: 0, rowCount: 5, rowsPut: 5 }] }),
    });
    const t = track();
    const out = await uploadOneFile(file(), { api, reader: reader([block(0, 5)]), fetch: fakeFetch().fn }, { onItem: t.onItem });
    expect(out).toEqual({ artifactId: "A1", step: "seenBefore" });
    expect(calls.map((c) => c.name)).toEqual([]);
    expect(t.item.seenOn).toBe(1_700_000_000_000);
  });

  test("the same file again attaches the raw bytes when storage has come on since", async () => {
    const { api, calls } = fakeApi({
      artifactBegin: async () => ({ artifactId: "A1", existing: true, uploadedAt: 1, upload: { url: "https://api.test/u", ticket: "T9", expiresAt: 1 } }),
      artifactGet: async () => ({ readState: "read", vaultState: "not_stored", blocks: [{ id: "B0", ordinal: 0, rowCount: 5, rowsPut: 5 }] }),
    });
    const { fn, puts } = fakeFetch();
    const out = await uploadOneFile(file(), { api, reader: reader([]), fetch: fn }, { onItem: () => undefined });
    expect(out.step).toBe("seenBefore");
    expect(puts).toHaveLength(1);
    expect(calls.map((c) => c.name)).toEqual(["commitRaw"]);
  });

  test("a file the server holds but did not finish resumes from the rows it has", async () => {
    const { api, calls } = fakeApi({
      artifactBegin: async () => ({ artifactId: "A1", existing: true, uploadedAt: 1, upload: null }),
      artifactGet: async () => ({ readState: "reading", vaultState: "stored", blocks: [{ id: "B0", ordinal: 0, rowCount: 1201, rowsPut: 500 }] }),
    });
    const t = track();
    const out = await uploadOneFile(file(), { api, reader: reader([block(0, 1201)]), fetch: fakeFetch().fn }, { onItem: t.onItem });
    expect(out.step).toBe("done");
    expect(calls.map((c) => c.name)).toEqual(["putRows", "putRows", "complete"]);
    const rows = calls.filter((c) => c.name === "putRows").map((c) => c.input as { fromIndex: number; expectRowsPut: number; rows: unknown[] });
    expect(rows.map((r) => [r.fromIndex, r.expectRowsPut, r.rows.length])).toEqual([[500, 500, 500], [1000, 1000, 201]]);
    expect(t.item.sent).toEqual({ rows: 1201, total: 1201 });
  });

  test("a file over its limit is refused before it is read or hashed", async () => {
    const { api, calls } = fakeApi();
    let hashed = false;
    const big = { name: "dump.xlsx", size: 20 * 1024 * 1024 + 1, type: "" } as File;
    const t = track();
    const out = await uploadOneFile(big, { api, reader: reader([], { hash: async () => ((hashed = true), "x") }) }, { onItem: t.onItem });
    expect(out.step).toBe("refused");
    expect(t.item.problem).toEqual({ key: "ingest.drop.tooBig", vars: { name: "dump.xlsx", limit: 20 } });
    expect(hashed).toBe(false);
    expect(calls).toEqual([]);
  });

  test("an unknown file type is refused as unreadable", async () => {
    const t = track();
    const out = await uploadOneFile(file("notes.docx"), { api: fakeApi().api, reader: reader([]) }, { onItem: t.onItem });
    expect(out.step).toBe("refused");
    expect(t.item.problem).toEqual({ key: "ingest.read.failed" });
  });

  test("too many rows from the reader refuses with the file name", async () => {
    const { api, calls } = fakeApi();
    const t = track();
    const r = reader([], { read: async () => { throw new ReadError({ code: "too_many_rows", rows: 250_000 }); } });
    const out = await uploadOneFile(file("big.csv"), { api, reader: r, fetch: fakeFetch().fn }, { onItem: t.onItem });
    expect(out.step).toBe("refused");
    expect(t.item.problem).toEqual({ key: "ingest.drop.tooManyRows", vars: { name: "big.csv" } });
    expect(calls.map((c) => c.name)).not.toContain("putBlocks");
  });

  test("the open-rows limit from begin is its own message", async () => {
    const { api } = fakeApi({
      artifactBegin: async () => { throw Object.assign(new Error("Too many rows are waiting. Merge or discard older imports first."), { data: { code: "BAD_REQUEST" } }); },
    });
    const t = track();
    const out = await uploadOneFile(file(), { api, reader: reader([]) }, { onItem: t.onItem });
    expect(out.step).toBe("refused");
    expect(t.item.problem).toEqual({ key: "ingest.drop.openLimit" });
  });

  test("other failures throw so the screen shows Could not read with Retry", async () => {
    const { api } = fakeApi({ artifactBegin: async () => { throw new TypeError("Failed to fetch"); } });
    await expect(uploadOneFile(file(), { api, reader: reader([]) }, { onItem: () => undefined })).rejects.toThrow("Failed to fetch");
    const { api: api2 } = fakeApi();
    const bad = { ...fakeFetch(), fn: (async () => new Response("no", { status: 403 })) as unknown as typeof fetch };
    await expect(uploadOneFile(file(), { api: api2, reader: reader([block(0, 1)]), fetch: bad.fn }, { onItem: () => undefined })).rejects.toThrow("upload failed (403)");
  });

  test("a canonical PUT that fails does not fail the import", async () => {
    const { api } = fakeApi();
    let n = 0;
    const flaky = (async () => (n++ === 0 ? new Response("{}", { status: 200 }) : new Response("no", { status: 500 }))) as unknown as typeof fetch;
    const out = await uploadOneFile(file(), { api, reader: reader([block(0, 2)]), fetch: flaky }, { onItem: () => undefined });
    expect(out.step).toBe("done");
  });

  test("the note goes to begin", async () => {
    const { api, calls } = fakeApi();
    await uploadOneFile(file(), { api, reader: reader([block(0, 1)]), fetch: fakeFetch().fn }, { onItem: () => undefined, note: "October book" });
    expect(calls[0]!.input).toMatchObject({ note: "October book" });
  });

  test("limits come from the server when given", async () => {
    const t = track();
    const limits = { ...DEFAULT_LIMITS, maxFileBytes: { ...DEFAULT_LIMITS.maxFileBytes, sheet: 10 } };
    const out = await uploadOneFile(file("a.xlsx", 20), { api: fakeApi().api, reader: reader([]), limits }, { onItem: t.onItem });
    expect(out.step).toBe("refused");
  });
});

describe("helpers", () => {
  test("ticket url keeps an existing ticket and adds a missing one", () => {
    expect(ticketUrl({ url: "https://a.test/files/ingest/upload?ticket=Z", ticket: "T" })).toBe("https://a.test/files/ingest/upload?ticket=Z");
    expect(ticketUrl({ url: "https://a.test/files/ingest/upload", ticket: "a b" })).toBe("https://a.test/files/ingest/upload?ticket=a+b");
  });
  test("begin errors that are plain refusals", () => {
    expect(problemFromError(new Error("Merge or discard older imports first"), "a.csv", 50)).toEqual({ key: "ingest.drop.openLimit" });
    expect(problemFromError(new Error("File is too big"), "a.csv", 50)).toEqual({ key: "ingest.drop.tooBig", vars: { name: "a.csv", limit: 50 } });
    expect(problemFromError(new Error("boom"), "a.csv", 50)).toBeNull();
  });
});
