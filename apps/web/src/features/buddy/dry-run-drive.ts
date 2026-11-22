/**
 * The row check a confirmed `import.runDryRun` draft runs (fix round decision 8): the bubble calls
 * `ingest.dryRun.step` under the person's own session until the candidate is no longer `processing`, then reports
 * with `buddy.drafts.report`. Plain logic, no React; `use-dry-run-drive.ts` wires it. Kept small on purpose so the
 * bubble's lazy chunk does not pull in the import screens' pump.
 *
 * The loop never decides the outcome (delta round S2, decision 3): it only says the run ended, failed or was aborted.
 * The report makes the server read the candidate's own state and store `result.dryRun = { outcome, state }`; the card
 * shows that, never a guess made here.
 */

export type DryRunCounts = {
  total: number;
  create: number;
  update: number;
  unchanged: number;
  ambiguous: number;
  conflict: number;
  refused: number;
  skipped: number;
};
export type DryRunStep = { cursor: number; done: boolean; counts: DryRunCounts };
export type DryRunRead = { cursor: number; running: boolean; counts: DryRunCounts | null };

/** How the loop stopped: "ended" means the candidate left `processing` (for any reason: ready, discarded, ...). */
export type DriveOutcome = "ended" | "failed" | "aborted";

/** What the server stored when the browser reported (`buddy_draft.result_json.dryRun`). */
export type StoredDryRun = { outcome: "done" | "stopped" | "failed"; state: string };

const STORED_OUTCOMES: readonly string[] = ["done", "stopped", "failed"];

/** The server's stored outcome of a dry run draft, from its `result`; null when there is none (yet). */
export function storedDryRun(result: unknown): StoredDryRun | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const dry = (result as { dryRun?: unknown }).dryRun;
  if (!dry || typeof dry !== "object" || Array.isArray(dry)) return null;
  const { outcome, state } = dry as { outcome?: unknown; state?: unknown };
  if (typeof outcome !== "string" || !STORED_OUTCOMES.includes(outcome) || typeof state !== "string") return null;
  return { outcome: outcome as StoredDryRun["outcome"], state };
}

/**
 * The bubble's last words after `buddy.drafts.report` answered with the draft's view (or failed: null): the stored
 * outcome and state word, or "unknown" when nothing was stored. Never the loop's own guess.
 */
export function phaseAfterReport(view: { result?: unknown } | null | undefined): { phase: StoredDryRun["outcome"] | "unknown"; state: string | null } {
  const stored = storedDryRun(view?.result);
  return stored ? { phase: stored.outcome, state: stored.state } : { phase: "unknown", state: null };
}

/** Rows checked so far, out of the total (the import screen's own count). */
export function checkedRows(counts: DryRunCounts | null): { done: number; total: number } | null {
  if (!counts || counts.total <= 0) return null;
  const done = counts.create + counts.update + counts.unchanged + counts.ambiguous + counts.conflict + counts.refused + counts.skipped;
  return { done: Math.min(done, counts.total), total: counts.total };
}

const isConflict = (e: unknown) => (e as { data?: { code?: unknown } } | null)?.data?.code === "CONFLICT";

export type DriveDeps = {
  read(): Promise<DryRunRead>;
  step(expectCursor: number): Promise<DryRunStep>;
  signal: AbortSignal;
  onProgress(counts: DryRunCounts | null): void;
  /** Another tab holds the cursor (CONFLICT): this one waits and looks again. */
  onOtherTab(other: boolean): void;
  sleep?(ms: number): Promise<void>;
  pollMs?: number;
  /** Conflicts in a row before giving up. */
  maxConflicts?: number;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runDryRunDrive(deps: DriveDeps): Promise<DriveOutcome> {
  const sleep = deps.sleep ?? realSleep;
  const pollMs = deps.pollMs ?? 3000;
  const maxConflicts = deps.maxConflicts ?? 40;
  let conflicts = 0;
  for (;;) {
    if (deps.signal.aborted) return "aborted";
    let stored: DryRunRead;
    try {
      stored = await deps.read();
    } catch {
      return deps.signal.aborted ? "aborted" : "failed";
    }
    deps.onProgress(stored.counts);
    if (!stored.running) return "ended";
    let cursor = stored.cursor;
    for (;;) {
      if (deps.signal.aborted) return "aborted";
      let r: DryRunStep;
      try {
        r = await deps.step(cursor);
      } catch (error) {
        if (deps.signal.aborted) return "aborted";
        if (!isConflict(error)) {
          // A step that lands after the work finished is refused: the stored state decides.
          try {
            if (!(await deps.read()).running) return "ended";
          } catch {
            // keep the failure
          }
          return "failed";
        }
        conflicts += 1;
        if (conflicts > maxConflicts) return "failed";
        deps.onOtherTab(true);
        await sleep(pollMs);
        break;
      }
      conflicts = 0;
      deps.onOtherTab(false);
      deps.onProgress(r.counts);
      if (r.done) return "ended";
      cursor = r.cursor;
    }
  }
}
