import type { AddBundlesReport } from "../scan/outcome";
import { needsResolve, type ResolveHit } from "../scan/scan-flow";

/** The server takes at most 100 serials per `dispatch.addBundlesBySerial`. */
export const PASTE_CHUNK = 100;

export const emptyReport = (): AddBundlesReport => ({ added: [], alreadyInDispatch: [], notFound: [], unavailable: [] });

/** One report from many: every list concatenated in order. */
export function mergeReports(...reports: AddBundlesReport[]): AddBundlesReport {
  const out = emptyReport();
  for (const r of reports) {
    out.added.push(...r.added);
    out.alreadyInDispatch.push(...r.alreadyInDispatch);
    out.notFound.push(...r.notFound);
    out.unavailable.push(...r.unavailable);
  }
  return out;
}

export type PasteOutcome = {
  report: AddBundlesReport;
  /** Index of the first serial that was never sent (a chunk failed), else null. */
  failedAt: number | null;
  error?: unknown;
};

/**
 * Sends the serials in chunks of 100, in order, and merges what came back.
 * A chunk that fails stops the run: everything before it is in `report`
 * (those bundles ARE added), `failedAt` says where to carry on from.
 */
export async function addPastedSerials(serials: readonly string[], send: (chunk: string[]) => Promise<AddBundlesReport>): Promise<PasteOutcome> {
  const reports: AddBundlesReport[] = [];
  for (let at = 0; at < serials.length; at += PASTE_CHUNK) {
    try {
      reports.push(await send(serials.slice(at, at + PASTE_CHUNK)));
    } catch (error) {
      return { report: mergeReports(...reports), failedAt: at, error };
    }
  }
  return { report: mergeReports(...reports), failedAt: null };
}

export type ResolvedPaste = {
  /** What to send to the server: plant numbers as pasted, old codes as the bundle number they resolve to. */
  serials: string[];
  notFound: string[];
  /** Old codes that match more than one bundle: the person types the full number. */
  ambiguous: string[];
};

/**
 * Old month-only codes (`J540`) and legacy ids are resolved to a bundle
 * number before the add, because the server matches the stored number
 * exactly. Everything else passes straight through. A resolver that throws
 * (network) rejects the whole call: nothing was added yet.
 */
export async function resolvePasted(serials: readonly string[], resolve: (code: string) => Promise<ResolveHit>): Promise<ResolvedPaste> {
  const out: ResolvedPaste = { serials: [], notFound: [], ambiguous: [] };
  const seen = new Set<string>();
  const push = (serial: string) => {
    if (!seen.has(serial)) {
      seen.add(serial);
      out.serials.push(serial);
    }
  };
  for (const serial of serials) {
    if (!needsResolve(serial)) {
      push(serial);
      continue;
    }
    const hit = await resolve(serial);
    if (hit.kind === "bundle") push(hit.number);
    else if (hit.kind === "ambiguous") out.ambiguous.push(serial);
    else out.notFound.push(serial);
  }
  return out;
}
