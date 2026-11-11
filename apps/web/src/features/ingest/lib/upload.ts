import type { IngestApi } from "./api";
import {
  BLOCKS_PER_CALL, chunk, DEFAULT_LIMITS, detectFileKind, fileSizeProblem, rowCountProblem, rowPages,
  type FileProblem,
} from "./limits";
import { ReadError, type ReadResult } from "./reader-client";
import type { ReadProgress } from "./reader-protocol";
import type { ArtifactKind, IngestLimits, UploadTicketOut } from "./types";

/**
 * Where a file is in the upload. The screen shows the step with these keys:
 * `hashing`, `reading` (`ingest.read.reading` with sheet and rows), `saving` (`ingest.read.uploading`),
 * `sending` (rows going to the server), `done`, `seenBefore` (`ingest.drop.seenBefore`), `refused`
 * (`problem` holds the key and variables) and `failed` (`ingest.read.failed`).
 */
export type UploadStep = "queued" | "hashing" | "reading" | "saving" | "sending" | "done" | "seenBefore" | "refused" | "failed";

export type UploadItem = {
  id: string;
  name: string;
  size: number;
  kind: ArtifactKind | null;
  step: UploadStep;
  /** Latest reader progress, for the bar. */
  progress: ReadProgress | null;
  /** Rows sent so far and in all, for the bar while `sending`. */
  sent: { rows: number; total: number } | null;
  artifactId: string | null;
  /** For `seenBefore`: when the file was first uploaded (ms). */
  seenOn: number | null;
  /** The raw bytes were not kept (no storage on this plant). */
  notStored: boolean;
  problem: FileProblem | null;
};

/** What the upload needs from the reader: injected so tests can use a fake. */
export type UploadReader = {
  hash: (file: File, signal?: AbortSignal) => Promise<string>;
  read: (file: File, opts: { onProgress?: (p: ReadProgress) => void; signal?: AbortSignal }) => Promise<ReadResult>;
};

export type UploadClientDeps = {
  api: IngestApi;
  limits?: IngestLimits;
  reader: UploadReader;
  /** Defaults to `fetch`. */
  fetch?: typeof fetch;
};

export class UploadPutError extends Error {
  constructor(readonly status: number) {
    super(`upload failed (${status})`);
  }
}

/** The URL a ticket PUTs to: the route's own URL with `ticket=` added when the server did not. */
export function ticketUrl(upload: Pick<UploadTicketOut, "url" | "ticket">, base?: string): string {
  const url = new URL(upload.url, base ?? (typeof location === "undefined" ? "http://localhost" : location.href));
  if (!url.searchParams.has("ticket")) url.searchParams.set("ticket", upload.ticket);
  return url.href;
}

/** One JSON array of cell strings per line, gzip. Built as a stream so 200,000 rows are never one string. */
export async function gzipJsonl(rows: readonly string[][]): Promise<Blob> {
  const encoder = new TextEncoder();
  let next = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next >= rows.length) return controller.close();
      const end = Math.min(rows.length, next + 1000);
      let text = "";
      for (; next < end; next += 1) text += `${JSON.stringify(rows[next])}\n`;
      controller.enqueue(encoder.encode(text));
    },
  });
  return new Response(source.pipeThrough(new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).blob();
}

async function put(f: typeof fetch, upload: UploadTicketOut, body: Blob, contentType: string): Promise<void> {
  const res = await f(ticketUrl(upload), { method: "PUT", headers: { "content-type": contentType }, body });
  if (!res.ok) throw new UploadPutError(res.status);
}

/** A begin error that is a plain refusal, as the screen's problem line, or null. */
export function problemFromError(error: unknown, name: string, limitMb: number | null): FileProblem | null {
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (/merge or discard/i.test(message)) return { key: "ingest.drop.openLimit" };
  if (/too big|larger than|exceeds/i.test(message) && limitMb !== null) return { key: "ingest.drop.tooBig", vars: { name, limit: limitMb } };
  return null;
}

/**
 * Tells the server the browser could not read the file (`artifact.complete` with `readError`, plan B7). The
 * server's input accepts it (`completeInput`); the router skeleton still types `complete` with the id only,
 * hence the cast. Best effort: a failure here changes nothing for the person.
 */
async function reportReadFailure(api: IngestApi, artifactId: string, readError: string): Promise<void> {
  const complete = api.artifactComplete as unknown as (input: { artifactId: string; readError: string }) => Promise<unknown>;
  await complete({ artifactId, readError }).catch(() => undefined);
}

type Hooks = { onItem: (patch: Partial<UploadItem>) => void; signal?: AbortSignal; note?: string };

/**
 * Sends one file through the whole path (plan A1, A2): hash, `artifact.begin`, the raw PUT and `commitRaw`
 * when a ticket came back, the read, `putBlocks` (50 blocks a call), `putRows` (500 rows a call with
 * `expectRowsPut`), `complete`, then the canonical rows as gzip to each canonical ticket. A file the server
 * already holds and has fully read opens that artifact (`seenBefore`) and sends nothing but, if a ticket came
 * back, the raw bytes. A file the server holds but has not finished resumes from the rows it has.
 */
export async function uploadOneFile(
  file: File,
  deps: UploadClientDeps,
  hooks: Hooks,
): Promise<{ artifactId: string | null; step: UploadStep }> {
  const { api, reader } = deps;
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const send = deps.fetch ?? fetch;
  const { onItem, signal } = hooks;
  const found = detectFileKind(file.name, file.type, limits);
  const refuse = (problem: FileProblem) => {
    onItem({ step: "refused", problem });
    return { artifactId: null, step: "refused" as const };
  };

  const tooBig = fileSizeProblem(file, limits);
  if (tooBig || !found) return refuse(tooBig ?? { key: "ingest.read.failed" });

  onItem({ step: "hashing", kind: found.kind, problem: null });
  const sha256 = await reader.hash(file, signal);

  let begin;
  try {
    begin = await api.artifactBegin({
      sha256, fileName: file.name, sizeBytes: file.size, contentType: file.type || null, kind: found.kind,
      ...(hooks.note ? { note: hooks.note } : {}),
    });
  } catch (error) {
    const problem = problemFromError(error, file.name, found.limitMb);
    if (problem) return refuse(problem);
    throw error;
  }
  const artifactId = begin.artifactId;
  onItem({ artifactId });

  const saveRaw = async () => {
    if (!begin.upload) return;
    onItem({ step: "saving" });
    await put(send, begin.upload, file, file.type || "application/octet-stream");
    await api.artifactCommitRaw({ artifactId });
  };

  // Blocks the server already has (a file read before): keyed by ordinal.
  let known: Map<number, { blockId: string; rowCount: number; rowsPut: number }> | null = null;
  if (begin.existing) {
    const art = await api.artifactGet({ artifactId });
    const complete = art.readState === "read" && art.blocks.every((b) => b.rowsPut >= b.rowCount);
    if (complete) {
      await saveRaw();
      onItem({ step: "seenBefore", seenOn: begin.uploadedAt, notStored: art.vaultState === "not_stored" });
      return { artifactId, step: "seenBefore" };
    }
    if (art.blocks.length > 0) {
      known = new Map(art.blocks.map((b) => [b.ordinal, { blockId: b.id, rowCount: b.rowCount, rowsPut: b.rowsPut }]));
    }
  }
  await saveRaw();
  const notStored = begin.upload === null && !begin.existing;
  onItem({ notStored });

  onItem({ step: "reading" });
  let read: ReadResult;
  try {
    read = await reader.read(file, { onProgress: (progress) => onItem({ progress }), signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    // Tell the server the file could not be read, so its candidates show Could not read and not "reading" forever.
    const readError = error instanceof ReadError ? error.failure.code : "unreadable";
    await reportReadFailure(api, artifactId, readError);
    if (error instanceof ReadError && error.failure.code === "too_many_rows") {
      return refuse({ key: "ingest.drop.tooManyRows", vars: { name: file.name } });
    }
    throw error;
  }
  const over = rowCountProblem(file.name, read.rawRows, limits);
  if (over) return refuse(over);

  // Blocks: send only the ones the server does not have.
  const ids = new Map<number, string>();
  const missing = read.blocks.filter((b) => !known?.has(b.input.ordinal));
  if (known) for (const [ordinal, k] of known) ids.set(ordinal, k.blockId);
  for (const group of chunk(missing, BLOCKS_PER_CALL)) {
    const res = await api.artifactPutBlocks({ artifactId, blocks: group.map((b) => b.input) });
    for (const b of res.blocks) ids.set(b.ordinal, b.blockId);
  }

  // Rows, 500 a call, each telling the server how many it already holds.
  const total = read.blocks.reduce((n, b) => n + b.rows.length, 0);
  let sent = 0;
  onItem({ step: "sending", sent: { rows: 0, total } });
  for (const block of read.blocks) {
    const blockId = ids.get(block.input.ordinal);
    if (!blockId) throw new Error(`The server did not return block ${block.input.ordinal}`);
    let holds = known?.get(block.input.ordinal)?.rowsPut ?? 0;
    sent += holds;
    for (const page of rowPages(block.rows)) {
      if (page.fromIndex + page.rows.length <= holds) continue;
      const from = Math.max(page.fromIndex, holds);
      const rows = page.rows.slice(from - page.fromIndex);
      const res = await api.artifactPutRows({ blockId, fromIndex: from, expectRowsPut: holds, rows });
      sent += res.rowsPut - holds;
      holds = res.rowsPut;
      onItem({ sent: { rows: sent, total } });
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    }
  }

  const done = await api.artifactComplete({ artifactId });
  // The canonical copy lets staged rows be rebuilt later. A miss here does not undo the import.
  for (const upload of done.canonicalUploads) {
    const block = read.blocks.find((b) => b.input.ordinal === upload.blockOrdinal);
    if (!block) continue;
    try {
      await put(send, { url: upload.url, ticket: upload.ticket, expiresAt: 0 }, await gzipJsonl(block.rows), "application/gzip");
    } catch {
      // not fatal
    }
  }
  onItem({ step: "done" });
  return { artifactId, step: "done" };
}
