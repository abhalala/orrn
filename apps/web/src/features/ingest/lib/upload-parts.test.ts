import { describe, expect, test } from "bun:test";

import type { IngestApi } from "./api";
import { DEFAULT_LIMITS } from "./limits";
import { ReadError } from "./reader-client";
import { uploadOneFile, type UploadItem } from "./upload";
import { PartPutError, sendParts } from "./upload-parts";

/** A fake server for the chunked upload: parts done, tickets asked, PUT status per call. */
function fakeServer(opts: { done?: number[]; status?: (part: number, attempt: number) => number } = {}) {
  const log: string[] = [];
  const putBytes = new Map<number, number>();
  const attempts = new Map<number, number>();
  let starts = 0;
  const api = {
    artifactUploadStart: async (i: { parts: string[] }) => {
      starts += 1;
      log.push(`start:${i.parts.length}`);
      return { partSize: 4, partCount: i.parts.length, done: starts === 1 ? (opts.done ?? []) : [...putBytes.keys()] };
    },
    artifactUploadTickets: async (i: { parts: number[] }) => {
      log.push(`tickets:${i.parts.join(",")}`);
      return { tickets: i.parts.map((part) => ({ part, url: `https://api.test/files/ingest/part?p=${part}&n=${log.length}`, expiresAt: 1 })) };
    },
    artifactUploadComplete: async () => {
      log.push("complete");
      return { vaultState: "stored" as const };
    },
  };
  const fetch = (async (url: string, init: RequestInit) => {
    const part = Number(new URL(url).searchParams.get("p"));
    const n = (attempts.get(part) ?? 0) + 1;
    attempts.set(part, n);
    const status = opts.status?.(part, n) ?? 200;
    if (status === 200) putBytes.set(part, (init.body as Blob).size);
    log.push(`put:${part}:${status}`);
    return new Response("", { status });
  }) as unknown as typeof fetch;
  return { api, fetch, log, putBytes };
}

const file = (size: number) => new Blob([new Uint8Array(size)]);
const digests = (n: number) => Array.from({ length: n }, (_, i) => String(i).padStart(64, "0"));

describe("sendParts", () => {
  test("every part is PUT as a slice of the file, the last one shorter, then complete", async () => {
    const s = fakeServer();
    const seen: number[] = [];
    await sendParts({ api: s.api, file: file(10), artifactId: "A1", partSize: 4, parts: digests(3), fetch: s.fetch, onProgress: (p) => seen.push(p.parts) });
    expect([...s.putBytes.entries()].sort()).toEqual([[1, 4], [2, 4], [3, 2]]);
    expect(s.log[0]).toBe("start:3");
    expect(s.log.at(-1)).toBe("complete");
    expect(seen.at(-1)).toBe(3);
  });

  test("resume: only the parts the server does not hold go", async () => {
    const s = fakeServer({ done: [1, 3] });
    await sendParts({ api: s.api, file: file(10), artifactId: "A1", partSize: 4, parts: digests(3), fetch: s.fetch });
    expect([...s.putBytes.keys()]).toEqual([2]);
    expect(s.log.filter((l) => l.startsWith("tickets"))).toEqual(["tickets:2"]);
  });

  test("a ticket that ran out (403) is asked again once; a second 403 stops the upload", async () => {
    const s = fakeServer({ status: (part, n) => (part === 2 && n === 1 ? 403 : 200) });
    await sendParts({ api: s.api, file: file(10), artifactId: "A1", partSize: 4, parts: digests(3), fetch: s.fetch });
    expect(s.log).toContain("put:2:403");
    expect(s.putBytes.has(2)).toBe(true);
    const t = fakeServer({ status: (part) => (part === 1 ? 403 : 200) });
    await expect(sendParts({ api: t.api, file: file(10), artifactId: "A1", partSize: 4, parts: digests(3), fetch: t.fetch })).rejects.toBeInstanceOf(PartPutError);
    expect(t.log).not.toContain("complete");
  });

  test("an upload R2 let run out (410) starts again once from the parts that are there", async () => {
    const s = fakeServer({ status: (part, n) => (part === 3 && n === 1 ? 410 : 200) });
    await sendParts({ api: s.api, file: file(10), artifactId: "A1", partSize: 4, parts: digests(3), fetch: s.fetch });
    expect(s.log.filter((l) => l.startsWith("start"))).toHaveLength(2);
    expect(s.log.at(-1)).toBe("complete");
  });

  test("cancelled: nothing more goes and complete is not called", async () => {
    const s = fakeServer();
    const ctl = new AbortController();
    ctl.abort();
    await expect(sendParts({ api: s.api, file: file(10), artifactId: "A1", partSize: 4, parts: digests(3), fetch: s.fetch, signal: ctl.signal })).rejects.toThrow("Cancelled");
    expect(s.log).not.toContain("complete");
  });
});

describe("uploadOneFile with parts", () => {
  const track = () => {
    const steps: string[] = [];
    let item: Partial<UploadItem> = {};
    return { steps, get item() { return item; }, onItem: (p: Partial<UploadItem>) => { item = { ...item, ...p }; if (p.step && steps.at(-1) !== p.step) steps.push(p.step); } };
  };

  test("a file over one part: begin answers parts, the parts go with the worker's digests, no single PUT, no commitRaw", async () => {
    const s = fakeServer();
    const calls: string[] = [];
    const api = {
      ...s.api,
      artifactBegin: async () => (calls.push("begin"), { artifactId: "A1", existing: false, uploadedAt: 1, upload: null, parts: { partSize: 4, partCount: 3 } }),
      artifactCommitRaw: async () => (calls.push("commitRaw"), { vaultState: "stored" }),
      artifactComplete: async () => (calls.push("complete"), { canonicalUploads: [] }),
      artifactGet: async () => ({ readState: "reading", vaultState: "stored", blocks: [] }),
    } as unknown as IngestApi;
    const pdf = new File(["%PDF-1.7\n", "x"], "big.pdf", { type: "application/pdf" });
    const t = track();
    const out = await uploadOneFile(pdf, {
      api,
      limits: DEFAULT_LIMITS,
      fetch: s.fetch,
      reader: { hash: async () => ({ sha256: "a".repeat(64), parts: digests(3) }), read: async () => { throw new Error("not read"); } },
    }, { onItem: t.onItem });
    expect(out.step).toBe("kept");
    expect(t.steps).toContain("saving");
    expect(s.log.at(-1)).toBe("complete");
    expect(calls).toEqual(["begin", "complete"]);
    expect(t.item.notStored).toBe(false);
  });

  test("digests of the worker's part size are made again when the server cuts the file otherwise, even at the same count (N8)", async () => {
    const s = fakeServer();
    const sent: string[][] = [];
    const api = {
      ...s.api,
      artifactUploadStart: async (i: { parts: string[] }) => (sent.push(i.parts), s.api.artifactUploadStart(i)),
      artifactBegin: async () => ({ artifactId: "A1", existing: false, uploadedAt: 1, upload: null, parts: { partSize: 4, partCount: 3 } }),
      artifactComplete: async () => ({ canonicalUploads: [] }),
      artifactGet: async () => ({ readState: "reading", vaultState: "stored", blocks: [] }),
    } as unknown as IngestApi;
    const pdf = new File(["%PDF-1.7\n", "x"], "big.pdf", { type: "application/pdf" });
    await uploadOneFile(pdf, {
      api,
      limits: DEFAULT_LIMITS,
      fetch: s.fetch,
      reader: { hash: async () => ({ sha256: "a".repeat(64), parts: digests(3) }), read: async () => { throw new Error("not read"); } },
    }, { onItem: () => {} });
    expect(sent[0]).toHaveLength(3);
    expect(sent[0]).not.toEqual(digests(3));
  });

  test("a sheet too large for this browser to read is kept with plain words, not refused", async () => {
    const reported: unknown[] = [];
    const api = {
      artifactBegin: async () => ({ artifactId: "A1", existing: false, uploadedAt: 1, upload: null, parts: null }),
      artifactComplete: async (i: unknown) => (reported.push(i), { canonicalUploads: [] }),
    } as unknown as IngestApi;
    const book = new File(["PK\u0003\u0004", "x"], "huge.xlsx");
    const t = track();
    const out = await uploadOneFile(book, {
      api,
      reader: { hash: async () => "a".repeat(64), read: async () => { throw new ReadError({ code: "too_large_to_read" }); } },
    }, { onItem: t.onItem });
    expect(out.step).toBe("kept");
    expect(t.item.keptWhy).toBe("tooLargeToRead");
    expect(t.item.problem).toBeNull();
    expect(reported).toEqual([{ artifactId: "A1", readError: "too_large_to_read" }]);
  });
});
