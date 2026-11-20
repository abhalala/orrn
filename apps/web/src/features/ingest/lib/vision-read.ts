import { errorCodeOf } from "./pump";
import type { ArtifactKind } from "./types";
import type { UploadItem } from "./upload";
import type { VisionApi } from "./vision-api";
import { openPages, runVisionPump, type VisionProgress, type VisionPumpResult } from "./vision-pump";
import { openVisualSource, RenderError, type PageSource } from "./vision-render";

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
    return { kind: "left", result, open: openPages(result.pages.pages).length };
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
