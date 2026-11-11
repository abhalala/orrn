import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { POLL_MS } from "./model";
import { drivePump, isConflict, runBotPump, STALE_POLLS, toPumpError } from "./pump";
import type { PumpError } from "./pump";
import { refreshIngest } from "./actions";
import { ingestKeys, useCandidate, useMergeRun } from "./queries";
import { ingestApi } from "./trpc-api";
import type {
  CandidateCounts,
  CandidateDetail,
  CandidateState,
  DryRunStepOut,
  MergeCandidateResult,
  MergeRunView,
  MergeStepOut,
  ShapeMakeOut,
} from "./types";

/** `idle` nothing to do, `running` this tab is stepping, `otherTab` another tab holds the cursor, `done`, `error`. */
export type PumpPhase = "idle" | "running" | "otherTab" | "done" | "error";

const sleepFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

type UiState<T> = { id: string | undefined; phase: PumpPhase; error: PumpError | null; value: T };

export type DryRunPump = {
  phase: PumpPhase;
  /** The candidate's state as last read, so a queue can skip one that is not `processing`. */
  state: CandidateState | null;
  cursor: number | null;
  /** Fresh counters from the last step, else from the stored candidate. */
  counts: CandidateCounts | null;
  /** 0 to 1; null while the row total is unknown. */
  progress: number | null;
  /** Rows the browser that is uploading has not sent yet. While above 0 the pump waits and does not step. */
  rowsMissing: number;
  error: PumpError | null;
  /** After `error`: step again from the stored cursor. */
  retry: () => void;
};

/**
 * Steps `ingest.dryRun.step` while the candidate is `processing` (plan A1 "pumps"). Resumes from the stored
 * `dryCursor` after a closed tab. `enabled: false` only reads. CONFLICT gives `otherTab` and the hook waits,
 * then takes over if that tab stops. Refreshes `candidate.get` and the lists when it finishes.
 */
export function useDryRunPump(candidateId: string | undefined, opts?: { enabled?: boolean }): DryRunPump {
  const qc = useQueryClient();
  const candidate = useCandidate(candidateId);
  const c = candidate.data;
  const eligible = (opts?.enabled ?? true) && Boolean(candidateId) && c?.state === "processing";
  const [ui, setUi] = useState<UiState<{ cursor: number | null; counts: CandidateCounts | null }>>({
    id: candidateId, phase: "idle", error: null, value: { cursor: null, counts: null },
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!eligible || !candidateId) return;
    const ctl = new AbortController();
    setUi((u) => ({ id: candidateId, phase: "running", error: null, value: u.id === candidateId ? u.value : { cursor: null, counts: null } }));
    const api = ingestApi();
    const readDetail = (): Promise<CandidateDetail> =>
      qc.fetchQuery({ queryKey: ingestKeys.candidate(candidateId), queryFn: () => api.candidateGet({ candidateId }), staleTime: 0 });

    const read = async () => {
      let d = await readDetail();
      // The uploading tab has rows left to send: wait for them instead of stepping.
      while (d.state === "processing" && d.rowsMissing > 0 && !ctl.signal.aborted) {
        await sleepFor(POLL_MS, ctl.signal);
        d = await readDetail();
      }
      return { cursor: d.dryCursor, running: d.state === "processing" };
    };

    void drivePump<DryRunStepOut>({
      read,
      step: (expectCursor) => api.dryRunStep({ candidateId, expectCursor }),
      cursorOf: (r) => r.cursor,
      isDone: (r) => r.done,
      maxStalls: 5,
      signal: ctl.signal,
      onStep: (r) => {
        setUi((u) => ({ ...u, value: { cursor: r.cursor, counts: r.counts } }));
        qc.setQueryData<CandidateDetail>(ingestKeys.candidate(candidateId), (old) =>
          old ? { ...old, counts: r.counts, state: r.state, dryCursor: r.cursor } : old,
        );
      },
      onOtherTab: (other) => setUi((u) => (u.phase === "done" || u.phase === "error" ? u : { ...u, phase: other ? "otherTab" : "running" })),
    }).then((outcome) => {
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "error") {
        setUi((u) => ({ ...u, phase: "error", error: toPumpError(outcome.error) }));
        return;
      }
      setUi((u) => ({ ...u, phase: "done" }));
      void refreshIngest(qc, candidateId);
    });
    return () => ctl.abort();
  }, [candidateId, eligible, attempt, qc]);

  const mine = ui.id === candidateId;
  const counts = (mine ? ui.value.counts : null) ?? c?.counts ?? null;
  const total = counts?.total ?? 0;
  const done = counts ? counts.create + counts.update + counts.unchanged + counts.ambiguous + counts.conflict + counts.refused + counts.skipped : 0;
  return {
    phase: mine ? ui.phase : "idle",
    state: c?.state ?? null,
    cursor: (mine ? ui.value.cursor : null) ?? c?.dryCursor ?? null,
    counts,
    progress: total > 0 ? Math.min(1, done / total) : null,
    rowsMissing: c?.rowsMissing ?? 0,
    error: mine ? ui.error : null,
    retry: useCallback(() => setAttempt((n) => n + 1), []),
  };
}

/** One dry run at a time for several candidates (the index screen after an upload). */
export function useDryRunQueue(
  candidateIds: readonly string[],
  opts?: { enabled?: boolean },
): { activeId: string | null; phase: PumpPhase; byId: Record<string, { phase: PumpPhase; progress: number | null }> } {
  const [finished, setFinished] = useState<Record<string, "done" | "error">>({});
  const activeId = candidateIds.find((id) => finished[id] === undefined) ?? null;
  const pump = useDryRunPump(activeId ?? undefined, { enabled: opts?.enabled });

  useEffect(() => {
    if (!activeId) return;
    if (pump.phase === "done" || pump.phase === "error") {
      setFinished((f) => ({ ...f, [activeId]: pump.phase as "done" | "error" }));
    } else if (pump.phase === "idle" && pump.state !== null && pump.state !== "processing") {
      // Nothing to run: it is already past the dry run.
      setFinished((f) => ({ ...f, [activeId]: "done" }));
    }
  }, [activeId, pump.phase, pump.state]);

  const byId: Record<string, { phase: PumpPhase; progress: number | null }> = {};
  for (const id of candidateIds) {
    if (id === activeId) byId[id] = { phase: pump.phase, progress: pump.progress };
    else byId[id] = { phase: finished[id] ?? "idle", progress: finished[id] === "done" ? 1 : null };
  }
  return { activeId, phase: pump.phase, byId };
}

export type MergePump = {
  phase: PumpPhase;
  /** The stored run from `merge.get`, polled every 3 s while the run is `planning` or `running`. */
  run: MergeRunView | null;
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

const RUNNING_RUN = new Set(["planning", "running"]);

/** Steps `ingest.merge.step` while the run is `planning` or `running`; resumes, `otherTab` and polling as above. */
export function useMergePump(runId: string | undefined): MergePump {
  const qc = useQueryClient();
  const query = useMergeRun(runId);
  const run = query.data ?? null;
  const eligible = Boolean(runId) && run !== null && RUNNING_RUN.has(run.state);
  const [ui, setUi] = useState<UiState<null>>({ id: runId, phase: "idle", error: null, value: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!eligible || !runId) return;
    const ctl = new AbortController();
    setUi({ id: runId, phase: "running", error: null, value: null });
    const api = ingestApi();
    const read = async () => {
      const d: MergeRunView = await qc.fetchQuery({
        queryKey: ingestKeys.run(runId), queryFn: () => api.mergeGet({ runId }), staleTime: 0,
      });
      return { cursor: d.cursor, running: RUNNING_RUN.has(d.state) };
    };
    void drivePump<MergeStepOut>({
      read,
      step: (expectCursor) => api.mergeStep({ runId, expectCursor }),
      cursorOf: (r) => r.cursor,
      isDone: (r) => !RUNNING_RUN.has(r.state),
      signal: ctl.signal,
      onStep: (r) =>
        qc.setQueryData<MergeRunView>(ingestKeys.run(runId), (old) =>
          old ? { ...old, state: r.state, cursor: r.cursor, chunksTotal: r.chunksTotal, chunksWritten: r.chunksWritten, chunksFailed: r.chunksFailed } : old,
        ),
      onOtherTab: (other) => setUi((u) => (u.phase === "done" || u.phase === "error" ? u : { ...u, phase: other ? "otherTab" : "running" })),
    }).then(async (outcome) => {
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "error") {
        setUi((u) => ({ ...u, phase: "error", error: toPumpError(outcome.error) }));
        return;
      }
      await refreshIngest(qc);
      await qc.invalidateQueries({ queryKey: ingestKeys.run(runId) });
      setUi((u) => ({ ...u, phase: "done" }));
    });
    return () => ctl.abort();
  }, [runId, eligible, attempt, qc]);

  const mine = ui.id === runId;
  const finished = run !== null && !RUNNING_RUN.has(run.state);
  const stop = useCallback(async () => {
    if (!runId) return;
    await ingestApi().mergeStop({ runId });
    await qc.invalidateQueries({ queryKey: ingestKeys.run(runId) });
  }, [runId, qc]);
  return {
    phase: mine && ui.phase !== "idle" ? ui.phase : finished ? "done" : "idle",
    run,
    results: run?.candidates ?? [],
    chunksTotal: run?.chunksTotal ?? 0,
    chunksWritten: run?.chunksWritten ?? 0,
    chunksFailed: run?.chunksFailed ?? 0,
    error: mine ? ui.error : null,
    retry: useCallback(() => setAttempt((n) => n + 1), []),
    stop,
  };
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
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<PumpError | null>(null);
  const start = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const api = ingestApi();
      try {
        const { runId } = await api.mergeStart();
        await refreshIngest(qc);
        return { runId, joined: false };
      } catch (e) {
        if (!isConflict(e)) throw e;
        const status = await api.status();
        if (!status.activeRunId) throw e;
        return { runId: status.activeRunId, joined: true };
      }
    } catch (e) {
      setError(toPumpError(e));
      throw e;
    } finally {
      setPending(false);
    }
  }, [qc]);
  return { start, pending, error };
}

export type BotPhase = "idle" | "working" | "otherTab" | "done" | "gaveUp" | "capped" | "error";

export type BotPump = {
  phase: BotPhase;
  /** The try the helper is on, 1 to 4: goes into `ingest.shape.working` as `{n}`. */
  attempt: number;
  model: string | null;
  lastOutcome: ShapeMakeOut["outcome"] | null;
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
  const qc = useQueryClient();
  const candidate = useCandidate(candidateId);
  const tries = candidate.data?.botAttempts ?? 0;
  const [ui, setUi] = useState<{
    id: string | undefined; phase: BotPhase; attempt: number; model: string | null;
    lastOutcome: ShapeMakeOut["outcome"] | null; error: PumpError | null;
  }>({ id: candidateId, phase: "idle", attempt: 0, model: null, lastOutcome: null, error: null });
  const ctlRef = useRef<AbortController | null>(null);

  useEffect(() => () => ctlRef.current?.abort(), []);

  const start = useCallback(() => {
    if (!candidateId || ctlRef.current) return;
    const id = candidateId;
    const ctl = new AbortController();
    ctlRef.current = ctl;
    const api = ingestApi();
    const fresh = () =>
      qc.fetchQuery({ queryKey: ingestKeys.candidate(id), queryFn: () => api.candidateGet({ candidateId: id }), staleTime: 0 });
    setUi({ id, phase: "working", attempt: tries + 1, model: null, lastOutcome: null, error: null });

    void (async () => {
      const outcome = await runBotPump({
        getSeq: async () => (await fresh()).serverSeq,
        make: (expectSeq) => api.shapeMake({ candidateId: id, expectSeq }),
        onCall: (call) =>
          setUi((u) => ({
            ...u, model: call.model, lastOutcome: call.outcome as ShapeMakeOut["outcome"],
            attempt: call.next === "retry" || call.next === "escalate" ? Math.min(4, call.attempt + 1) : call.attempt,
          })),
        signal: ctl.signal,
      });
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "conflict") {
        setUi((u) => ({ ...u, phase: "otherTab" }));
        // Another tab runs the helper. Wait for it; give up waiting when its count stops moving.
        let seen = (await fresh()).botAttempts;
        let still = 0;
        for (;;) {
          await sleepFor(POLL_MS, ctl.signal);
          if (ctl.signal.aborted) return;
          const d = await fresh().catch(() => null);
          if (!d) { still += 1; } else if (d.state !== "needs_shape") { setUi((u) => ({ ...u, phase: "done" })); break; }
          else if (d.botAttempts !== seen) { seen = d.botAttempts; still = 0; } else { still += 1; }
          if (still >= STALE_POLLS) { setUi((u) => ({ ...u, phase: "idle" })); break; }
        }
      } else if (outcome.kind === "error") {
        setUi((u) => ({ ...u, phase: "error", error: toPumpError(outcome.error) }));
      } else if (outcome.kind === "done" || outcome.kind === "capped" || outcome.kind === "gaveUp") {
        const phase: BotPhase = outcome.kind;
        setUi((u) => ({ ...u, phase }));
      }
      await refreshIngest(qc, id);
    })().finally(() => {
      if (ctlRef.current === ctl) ctlRef.current = null;
    });
  }, [candidateId, qc, tries]);

  const mine = ui.id === candidateId;
  return {
    phase: mine ? ui.phase : "idle",
    attempt: mine && ui.attempt > 0 ? ui.attempt : Math.min(4, tries + 1),
    model: mine ? ui.model : null,
    lastOutcome: mine ? ui.lastOutcome : null,
    error: mine ? ui.error : null,
    start,
  };
}

