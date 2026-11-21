import { useCallback, useEffect, useRef, useState } from "react";

import type { DriveView } from "./draft-card";
import { checkedRows, runDryRunDrive, type DryRunCounts, type DryRunRead, type DryRunStep } from "./dry-run-drive";
import type { BuddyDraft } from "./types";

export type DriveApi = {
  read(candidateId: string): Promise<DryRunRead>;
  step(candidateId: string, expectCursor: number): Promise<DryRunStep>;
  /** `buddy.drafts.report`; then the list is read again and the draft's `drive` is gone. */
  report(draftId: string, outcome: "done" | "stopped" | "failed", summary?: string): Promise<unknown>;
  /** After the run: the import screens and the drafts list read again. */
  refresh(): void;
};

/**
 * Drives one confirmed row-check draft at a time in the bubble (fix round decision 8) and reports it exactly once:
 * done, stopped (the person pressed Stop) or failed. Closing the plant or signing out unmounts the bubble: that
 * aborts the run without a report, so the next open picks it up again from the stored cursor.
 */
export function useDryRunDrive(drafts: readonly BuddyDraft[] | undefined, api: DriveApi) {
  const [views, setViews] = useState<Record<string, DriveView>>({});
  const finished = useRef(new Set<string>());
  const running = useRef<{ id: string; controller: AbortController; stopped: boolean } | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  const active = (drafts ?? []).find((d) => d.drive && d.status === "confirmed" && !finished.current.has(d.id)) ?? null;
  const activeId = active?.id ?? null;
  const candidateId = active?.drive?.candidateId ?? null;

  useEffect(() => {
    if (!activeId || !candidateId) return;
    const controller = new AbortController();
    const run = { id: activeId, controller, stopped: false };
    running.current = run;
    const set = (view: DriveView) => setViews((prev) => ({ ...prev, [activeId]: view }));
    let last: { done: number; total: number } | null = null;
    set({ phase: "starting", done: null, total: null });
    void runDryRunDrive({
      read: () => apiRef.current.read(candidateId),
      step: (cursor) => apiRef.current.step(candidateId, cursor),
      signal: controller.signal,
      onProgress: (counts: DryRunCounts | null) => {
        last = checkedRows(counts) ?? last;
        set({ phase: "running", done: last?.done ?? null, total: last?.total ?? null });
      },
      onOtherTab: (other) => {
        if (other) set({ phase: "otherTab", done: last?.done ?? null, total: last?.total ?? null });
      },
    }).then(async (outcome) => {
      if (running.current === run) running.current = null;
      // Unmounted (plant switch, sign-out): no report; the next open resumes from the stored cursor.
      if (outcome === "aborted" && !run.stopped) return;
      const reported = outcome === "aborted" ? "stopped" : outcome;
      finished.current.add(activeId);
      set({ phase: reported, done: last?.done ?? null, total: last?.total ?? null });
      const summary = last ? `${last.done} of ${last.total} rows checked` : undefined;
      await apiRef.current.report(activeId, reported, summary).catch(() => {});
      apiRef.current.refresh();
    });
    return () => controller.abort();
  }, [activeId, candidateId]);

  const driveFor = useCallback((id: string): DriveView | null => views[id] ?? null, [views]);
  const stop = useCallback((draft: BuddyDraft) => {
    const run = running.current;
    if (!run || run.id !== draft.id) return;
    run.stopped = true;
    run.controller.abort();
  }, []);
  return { driveFor, stop };
}
