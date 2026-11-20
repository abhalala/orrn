import { errorCodeOf } from "./pump";
import type { ArtifactKind } from "./types";
import type { UploadItem } from "./upload";
import type { VisionApi } from "./vision-api";
import { openPages, runVisionPump, type VisionProgress, type VisionPumpResult } from "./vision-pump";
import { openPdf, openVisualSource, RenderError, type PageSource, type RangeSource } from "./vision-render";

/**
 * One read of a PDF or photo, from the bytes in hand: open the pages, run the pump, close. Used by the upload (right
 * after the raw bytes are stored) and by the file page ("Read this file", the bytes fetched back by `vision.readUrl`).
 */

/** `vision.start` refused because this plant cannot read now (no storage, no model): the file stays kept. */
const CANNOT_READ_NOW = [/^PDFs and photos need file storage/i, /^PDFs and photos are kept, not read, in this release/i];

export function cannotReadNow(error: unknown): boolean {
  if (errorCodeOf(error) !== "PRECONDITION_FAILED") return false;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return CANNOT_READ_NOW.some((re) => re.test(message));
}

export type VisualReadOutcome =
  | { kind: "done"; result: VisionPumpResult }
  | { kind: "left"; result: VisionPumpResult; open: number }
  | { kind: "cannotOpen" }
  | { kind: "cannotReadNow" };

export async function readVisualBytes(input: {
  api: VisionApi;
  artifactId: string;
  file: Blob;
  kind: ArtifactKind;
  onProgress?: (p: VisionProgress) => void;
  signal?: AbortSignal;
  /** For tests: the page source. */
  open?: (file: Blob, kind: ArtifactKind) => Promise<PageSource>;
}): Promise<VisualReadOutcome> {
  input.onProgress?.({ phase: "opening" });
  let source: PageSource;
  try {
    source = await (input.open ?? openVisualSource)(input.file, input.kind);
  } catch (error) {
    if (error instanceof RenderError) return { kind: "cannotOpen" };
    throw error;
  }
  try {
    const result = await runVisionPump(input.artifactId, source, { api: input.api, signal: input.signal, onProgress: input.onProgress });
    if (result.completed) return { kind: "done", result };
    // Pages past the plan are not read either (contract section 12), unless a person left them on purpose.
    const unplanned = result.pages.restNotRead ? 0 : Math.max(0, result.pages.pageCount - result.pages.planned);
    return { kind: "left", result, open: openPages(result.pages.pages).length + unplanned };
  } catch (error) {
    if (cannotReadNow(error)) return { kind: "cannotReadNow" };
    throw error;
  } finally {
    source.close();
  }
}

/** The upload's `vision` hook on a given api: the pump's steps go to the file's row of the strip. */
export function uploadVisionHook(api: () => VisionApi) {
  return async (input: { artifactId: string; file: File; kind: ArtifactKind; onItem: (patch: Partial<UploadItem>) => void; signal?: AbortSignal }): Promise<"done" | "left" | "kept"> => {
    input.onItem({ step: "pages", pages: { phase: "opening" } });
    const out = await readVisualBytes({
      api: api(),
      artifactId: input.artifactId,
      file: input.file,
      kind: input.kind,
      signal: input.signal,
      onProgress: (pages) => input.onItem({ pages }),
    });
    switch (out.kind) {
      case "done":
        return "done";
      case "left":
        input.onItem({ pagesLeft: out.open });
        return "left";
      case "cannotOpen":
        input.onItem({ keptWhy: "cannotOpen" });
        return "kept";
      case "cannotReadNow":
        return "kept";
    }
  };
}

/** The read link ran out or the server refused the range: the bytes cannot be had now. */
export class RangeReadError extends Error {
  constructor(readonly status: number) {
    super(`range read failed (${status})`);
  }
}

/**
 * The stored file read back by range for "Read this file" (limits brief part B.4): a large PDF is opened page by page,
 * never fetched whole. The signed link lasts 10 minutes while a read with model calls runs longer, so the link is asked
 * again a minute before it runs out and once more on a 403.
 */
export async function remoteRangeSource(
  link: () => Promise<{ url: string; expiresAt: number }>,
  opts: { fetch?: typeof fetch; signal?: AbortSignal; now?: () => number } = {},
): Promise<RangeSource> {
  const send = opts.fetch ?? fetch;
  const clock = opts.now ?? Date.now;
  let current = await link();
  const get = async (begin: number, endInclusive: number): Promise<Response> => {
    for (let attempt = 0; ; attempt += 1) {
      if (current.expiresAt - clock() < 60_000) current = await link();
      const res = await send(current.url, { headers: { range: `bytes=${begin}-${endInclusive}` }, signal: opts.signal });
      if (res.status === 206) return res;
      if (res.status === 403 && attempt === 0) {
        current = await link();
        continue;
      }
      throw new RangeReadError(res.status);
    }
  };
  const first = await get(0, 0);
  const total = Number(/\/(\d+)$/.exec(first.headers.get("content-range") ?? "")?.[1] ?? NaN);
  await first.arrayBuffer();
  if (!Number.isFinite(total) || total < 1) throw new RangeReadError(first.status);
  return {
    length: total,
    read: async (begin, end) => new Uint8Array(await (await get(begin, Math.min(total, end) - 1)).arrayBuffer()),
  };
}

/** "Read this file" for a PDF: the stored bytes opened by range through `remoteRangeSource`. */
export async function openStoredPdf(link: () => Promise<{ url: string; expiresAt: number }>, signal?: AbortSignal): Promise<PageSource> {
  return openPdf(await remoteRangeSource(link, { signal }));
}
