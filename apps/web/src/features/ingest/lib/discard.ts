import { TARGET_KEY, type Words } from "./model";
import type { CandidateSummary } from "./types";

/**
 * Discard behind a confirm (M16). A slip loses a 1,400-row file, so the person is asked first. This is the state of
 * that question as a small pure machine, so a screen only draws it and a test can walk it.
 *
 * `idle` the overflow menu is closed. `asking` the dialog is open. `working` the server is called; the dialog stays
 * open and its buttons are `aria-disabled` (an early return, not `disabled`, so focus stays). `failed` the dialog
 * stays open with the error line. A success closes it (`idle`).
 */
export type DiscardState = { step: "idle" } | { step: "asking" } | { step: "working" } | { step: "failed"; error: unknown };

export type DiscardEvent = { type: "ask" } | { type: "cancel" } | { type: "confirm" } | { type: "done" } | { type: "fail"; error: unknown };

export function discardReduce(state: DiscardState, event: DiscardEvent): DiscardState {
  switch (event.type) {
    case "ask":
      return state.step === "idle" ? { step: "asking" } : state;
    case "cancel":
      // Cancel is ignored while the server works: the answer is coming either way.
      return state.step === "working" ? state : { step: "idle" };
    case "confirm":
      return state.step === "asking" || state.step === "failed" ? { step: "working" } : state;
    case "done":
      return { step: "idle" };
    case "fail":
      return state.step === "working" ? { step: "failed", error: event.error } : state;
  }
}

export const DISCARD_START: DiscardState = { step: "idle" };

/** The dialog's words: "Discard Sections?", "Its 1,400 rows will not be imported. You can add the file again later." */
export function discardWords(
  c: Pick<CandidateSummary, "target" | "sheetName" | "fileName" | "counts">,
  count: (n: number) => string = String,
): { title: Words; body: Words; confirm: Words; keep: Words } {
  return {
    title: c.target
      ? { key: "ingest.discard.title", varKeys: { name: TARGET_KEY(c.target) } }
      : { key: "ingest.discard.title", vars: { name: c.sheetName && c.sheetName.trim() !== "" ? c.sheetName : c.fileName } },
    body: { key: "ingest.discard.body", vars: { count: count(c.counts.total) } },
    confirm: { key: "ingest.action.discard" },
    keep: { key: "ingest.discard.keep" },
  };
}
