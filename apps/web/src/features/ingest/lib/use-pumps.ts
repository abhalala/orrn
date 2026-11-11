import type { CandidateCounts, MergeCandidateResult, MergeRunDetail, ShapeMakeResult } from "./types";
import type { PumpError } from "./pump";

const notBuilt = (name: string): never => {
  throw new Error(`${name} is not built yet`);
};

/** `idle` nothing to do, `running` this tab is stepping, `otherTab` another tab holds the cursor, `done`, `error`. */
export type PumpPhase = "idle" | "running" | "otherTab" | "done" | "error";

export type DryRunPump = {
  phase: PumpPhase;
  cursor: number | null;
  /** Fresh counters from the last step, else from the stored candidate. */
  counts: CandidateCounts | null;
  /** 0 to 1; null while the row total is unknown. */
  progress: number | null;
  error: PumpError | null;
  /** After `error`: step again from the stored cursor. */
  retry: () => void;
};

/**
 * Steps `ingest.dryRun.step` while the candidate is `processing` (plan A1 "pumps"). Resumes from the stored
 * `dryCursor` after a closed tab. `enabled: false` only reads. CONFLICT gives `otherTab` and the hook waits,
 * then takes over if that tab stops. Refreshes `candidate.get` and the candidate lists when it finishes.
 */
export function useDryRunPump(candidateId: string | undefined, opts?: { enabled?: boolean }): DryRunPump {
  void candidateId;
  void opts;
  return notBuilt("useDryRunPump");
}

/** One dry run at a time for several candidates (the index screen after an upload). */
export function useDryRunQueue(
  candidateIds: readonly string[],
  opts?: { enabled?: boolean },
): { activeId: string | null; phase: PumpPhase; byId: Record<string, { phase: PumpPhase; progress: number | null }> } {
  void candidateIds;
  void opts;
  return notBuilt("useDryRunQueue");
}

export type MergePump = {
  phase: PumpPhase;
  /** The stored run from `merge.get`, polled every 3 s while the run is `planning` or `running`. */
  run: MergeRunDetail | null;
  /** Per-candidate results, in the order the server returns them. */
  results: MergeCandidateResult[];
  chunksTotal: number;
  chunksWritten: number;
  chunksFailed: number;
  error: PumpError | null;
  retry: () => void;
  /** `merge.stop`: the run ends after the current part. */
  stop: () => Promise<void>;
};

/** Steps `ingest.merge.step` while the run is `planning` or `running`; resumes, `otherTab` and polling as above. */
export function useMergePump(runId: string | undefined): MergePump {
  void runId;
  return notBuilt("useMergePump");
}

/**
 * `ingest.merge.start`. If a run is already active the server answers CONFLICT and `joined` is true with the
 * active run's id (from `status`), so the screen opens that run instead.
 */
export function useStartMerge(): {
  start: () => Promise<{ runId: string; joined: boolean }>;
  pending: boolean;
  error: PumpError | null;
} {
  return notBuilt("useStartMerge");
}

export type BotPhase = "idle" | "working" | "otherTab" | "done" | "gaveUp" | "capped" | "error";

export type BotPump = {
  phase: BotPhase;
  /** The try the helper is on, 1 to 4: goes into `ingest.shape.working` as `{n}`. */
  attempt: number;
  model: string | null;
  lastOutcome: ShapeMakeResult["outcome"] | null;
  error: PumpError | null;
  /** "Map columns for me": calls `shape.make` until the server says `done` or `manual`. */
  start: () => void;
};

/**
 * The bot retry pump (plan A1, B6). Each `shape.make` is one model call; `next` is `retry` or `escalate` to
 * call again, `done` when a recipe was made, `manual` to hand over. `capped` gives `ingest.shape.capped`,
 * `gaveUp` gives `ingest.shape.gaveUp`. Each call carries the candidate's current `serverSeq` as `expectSeq`.
 */
export function useBotPump(candidateId: string | undefined): BotPump {
  void candidateId;
  return notBuilt("useBotPump");
}
