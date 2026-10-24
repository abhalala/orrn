import type { AddBundlesReport } from "@/features/scan/scan-outcome";

/** `dispatch.addBundlesBySerial` takes at most 100 serials per call (and keeps D1 statements under 100 params). */
export const PASTE_CHUNK = 100;

export function emptyReport(): AddBundlesReport {
  return { added: [], alreadyInDispatch: [], notFound: [], unavailable: [] };
}

export function reportTotal(r: AddBundlesReport): number {
  return r.added.length + r.alreadyInDispatch.length + r.notFound.length + r.unavailable.length;
}

export type ChunkedAddResult = {
  report: AddBundlesReport;
  /** Set when a request failed; the chunks before it are already in `report`. */
  error?: unknown;
  /** Serials not sent because of the error. */
  unsent: string[];
};

/**
 * Adds serials to a dispatch 100 at a time, one request after another (so a
 * long paste never races itself), merging the per-serial reports. A failure
 * stops the run and keeps what already went in.
 */
export async function addInChunks(
  serials: readonly string[],
  send: (chunk: string[]) => Promise<AddBundlesReport>,
  onProgress?: (done: number, total: number) => void,
): Promise<ChunkedAddResult> {
  const report = emptyReport();
  const total = serials.length;
  if (total === 0) return { report, unsent: [] };
  onProgress?.(0, total);
  for (let start = 0; start < total; start += PASTE_CHUNK) {
    const chunk = serials.slice(start, start + PASTE_CHUNK);
    try {
      const r = await send(chunk);
      report.added.push(...r.added);
      report.alreadyInDispatch.push(...r.alreadyInDispatch);
      report.notFound.push(...r.notFound);
      report.unavailable.push(...r.unavailable);
      if (r.refused?.length) (report.refused ??= []).push(...r.refused);
      // The last chunk's capacity is the dispatch's load after everything that went in.
      if (r.capacity) report.capacity = r.capacity;
    } catch (error) {
      return { report, error, unsent: serials.slice(start) };
    }
    onProgress?.(Math.min(start + PASTE_CHUNK, total), total);
  }
  return { report, unsent: [] };
}
