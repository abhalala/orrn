import { rowTitle, type RowTitle } from "./list-model";
import { candidateStateKey, candidateTone, TARGET_KEY, type Tone, type Words } from "./model";
import type { IngestTarget, MergeCandidateResult, MergeRunView } from "./types";

/**
 * The merge screen's model (work order 3.6, M14). The totals count only imports that merged: a held import wrote
 * nothing, so its rows are never in the headline. Held imports come first with their reasons, merged ones after,
 * quiet. Zero counts are left out.
 */

/** Where each target's list lives, for "See {target}" after a merge. The list is shown unfiltered. */
export const TARGET_LIST_PATH: Record<IngestTarget, string> = {
  customers: "/customers",
  customer_aliases: "/customers",
  vendors: "/vendors",
  vendor_aliases: "/vendors",
  dies: "/dies",
  die_copies: "/dies",
  bundles: "/stock/bundles",
  orders: "/orders",
};

export type MergePhase = "planning" | "running" | "done" | "stopped";

export function mergePhase(state: MergeRunView["state"]): MergePhase {
  if (state === "planning") return "planning";
  if (state === "running") return "running";
  if (state === "stopped") return "stopped";
  return "done";
}

export type MergeItem = {
  candidateId: string;
  title: RowTitle;
  /** The target's words when the title is a sheet or "New table": for the "See {target}" link. */
  target: IngestTarget | null;
  fileName: string;
  sheetName: string | null;
  chip: { words: Words; tone: Tone };
  /** Sans labels with mono numbers. Zero counts are left out. While running, "Added {n} of {total}" always shows. */
  counts: Words[];
  /** The reason in full ("Not merged. ..."): code and the server's detail. Draw it with `reasonPieces`. */
  reason: { code: string; detail: string | null } | null;
  /** "Open" opens the import on its review page: for held imports. */
  open: boolean;
};

export type MergeStatus = {
  tone: "info" | "success" | "warning";
  title: Words;
  /** The number in the block. Null while planning. */
  value: number | null;
  unit: Words | null;
  meta: Words | null;
  /** 0 to 1 by rows written over rows planned. Null while planning. */
  progress: number | null;
};

export type MergeView = {
  phase: MergePhase;
  /** The page title: "Merging 2 imports", "Merge finished", "Merge stopped". */
  title: Words;
  status: MergeStatus;
  /** "Stop after this part" shows while the run is moving and the person may merge. */
  canStop: boolean;
  /** The primary button once finished: "Back to imports"; "Merge the rest" after a stop (the screen starts a merge). */
  back: Words | null;
  mergeRest: Words | null;
  /** One secondary link per target that merged: "See Dies". */
  targetLinks: { target: IngestTarget; words: Words; to: string }[];
  held: MergeItem[];
  merged: MergeItem[];
  /** While running or stopped, every import in run order. */
  all: MergeItem[];
  /** Said once when the run finishes (`merge.announceDone`). Null before. */
  announce: Words | null;
  /** Rows written, planned. */
  rowsWritten: number;
  rowsPlanned: number;
};

const planned = (r: Pick<MergeCandidateResult, "rowsCreate" | "rowsUpdate">) => r.rowsCreate + r.rowsUpdate;

function itemOf(r: MergeCandidateResult, phase: MergePhase): MergeItem {
  const counts: Words[] = [];
  if (phase === "running" || phase === "planning") {
    counts.push({ key: "ingest.merge.addedOf", vars: { n: r.rowsWritten, total: planned(r) } });
  } else {
    if (r.rowsCreate > 0 && r.state === "merged") counts.push({ key: "ingest.merge.added", vars: { n: r.rowsCreate } });
    if (r.rowsUpdate > 0 && r.state === "merged") counts.push({ key: "ingest.merge.updated", vars: { n: r.rowsUpdate } });
  }
  const held = r.state === "held" || r.state === "failed";
  return {
    candidateId: r.candidateId,
    title: rowTitle({ target: r.target, sheetName: r.sheetName }),
    target: r.target,
    fileName: r.fileName,
    sheetName: r.sheetName,
    chip: { words: { key: candidateStateKey(r.state) }, tone: candidateTone(r.state) },
    counts,
    reason: r.reasonCode ? { code: r.reasonCode, detail: r.reasonDetail } : null,
    open: held,
  };
}

/**
 * `pump` is what `useMergePump` returns: the run, its per-import results, and the part counters. The totals use the
 * results of imports that merged (state `merged`) only.
 */
export function mergeView(
  run: Pick<MergeRunView, "state">,
  results: readonly MergeCandidateResult[],
  pump: { chunksTotal: number; chunksWritten: number; chunksFailed: number },
): MergeView {
  const phase = mergePhase(run.state);
  const merged = results.filter((r) => r.state === "merged");
  const heldResults = results.filter((r) => r.state === "held" || r.state === "failed");
  const created = merged.reduce((sum, r) => sum + r.rowsCreate, 0);
  const updated = merged.reduce((sum, r) => sum + r.rowsUpdate, 0);
  const rowsPlanned = results.reduce((sum, r) => sum + planned(r), 0);
  const rowsWritten = results.reduce((sum, r) => sum + r.rowsWritten, 0);
  const partsDone = pump.chunksWritten + pump.chunksFailed;
  const part = Math.min(pump.chunksTotal, partsDone + 1);

  let title: Words;
  let status: MergeStatus;
  if (phase === "planning" || phase === "running") {
    title = { key: "ingest.merge.titleRunning", vars: { count: results.length } };
    status = {
      tone: "info",
      title: { key: "ingest.state.merging" },
      value: phase === "planning" || pump.chunksTotal === 0 ? null : rowsWritten,
      unit: phase === "planning" || pump.chunksTotal === 0 ? null : { key: "ingest.merge.rowsUnit", vars: { total: rowsPlanned } },
      meta: phase === "planning" || pump.chunksTotal === 0
        ? { key: "ingest.merge.planning" }
        : { key: "ingest.merge.running", vars: { n: part, total: pump.chunksTotal } },
      progress: phase === "planning" || rowsPlanned === 0 ? null : Math.min(1, rowsWritten / rowsPlanned),
    };
  } else if (phase === "stopped") {
    title = { key: "ingest.merge.titleStopped" };
    status = {
      tone: "warning",
      title: { key: "ingest.merge.titleStopped" },
      value: created,
      unit: { key: "ingest.merge.rowsAdded" },
      meta: { key: "ingest.merge.partsWritten", vars: { done: pump.chunksWritten, total: pump.chunksTotal } },
      progress: null,
    };
  } else {
    title = { key: "ingest.merge.titleDone" };
    status = {
      tone: heldResults.length > 0 ? "warning" : "success",
      title: { key: "ingest.merge.titleDone" },
      value: created,
      unit: { key: "ingest.merge.rowsAdded" },
      meta: heldResults.length > 0
        ? { key: "ingest.merge.notMergedMeta", vars: { count: heldResults.length } }
        : { key: "ingest.merge.updatedMeta", vars: { count: updated } },
      progress: null,
    };
  }

  const seen = new Set<IngestTarget>();
  const targetLinks = merged.flatMap((r) => {
    if (!r.target || seen.has(r.target)) return [];
    seen.add(r.target);
    return [{ target: r.target, words: { key: "ingest.merge.see", varKeys: { target: TARGET_KEY(r.target) } }, to: TARGET_LIST_PATH[r.target] }];
  });

  return {
    phase,
    title,
    status,
    canStop: phase === "planning" || phase === "running",
    back: phase === "done" || phase === "stopped" ? { key: "ingest.merge.back" } : null,
    mergeRest: phase === "stopped" ? { key: "ingest.merge.rest" } : null,
    targetLinks: phase === "done" ? targetLinks : [],
    held: heldResults.map((r) => itemOf(r, phase)),
    merged: merged.map((r) => itemOf(r, phase)),
    all: results.map((r) => itemOf(r, phase)),
    announce: phase === "done"
      ? { key: "ingest.merge.announceDone", vars: { created, updated, held: heldResults.length } }
      : phase === "stopped"
        ? { key: "ingest.merge.titleStopped" }
        : null,
    rowsWritten,
    rowsPlanned,
  };
}
