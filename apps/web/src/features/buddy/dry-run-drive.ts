/**
 * The row check a confirmed `import.runDryRun` draft runs (fix round decision 8): the bubble calls
 * `ingest.dryRun.step` under the person's own session until the candidate is no longer `processing`, then reports
 * with `buddy.drafts.report`. Plain logic, no React; `use-dry-run-drive.ts` wires it. Kept small on purpose so the
 * bubble's lazy chunk does not pull in the import screens' pump.
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

export type DriveOutcome = "done" | "failed" | "aborted";

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
    if (!stored.running) return "done";
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
            if (!(await deps.read()).running) return "done";
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
      if (r.done) return "done";
      cursor = r.cursor;
    }
  }
}
