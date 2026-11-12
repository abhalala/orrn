import { useCallback, useReducer } from "react";

import { useIngestActions } from "./actions";
import { DISCARD_START, discardReduce, discardWords } from "./discard";
import type { CandidateSummary } from "./types";

/**
 * The discard confirm of one import (M16). `ask()` from the overflow menu opens the dialog, `confirm()` calls
 * `actions.discard` with the import's `serverSeq`, `cancel()` closes it. The words come from `discardWords`.
 * While `working`, `cancel` and a second `confirm` do nothing (give the buttons `aria-disabled`).
 */
export function useDiscardFlow(
  candidate: Pick<CandidateSummary, "id" | "serverSeq" | "target" | "sheetName" | "fileName" | "counts">,
  opts: { onDone?: () => void; count?: (n: number) => string } = {},
) {
  const actions = useIngestActions();
  const [state, dispatch] = useReducer(discardReduce, DISCARD_START);
  const ask = useCallback(() => dispatch({ type: "ask" }), []);
  const cancel = useCallback(() => dispatch({ type: "cancel" }), []);
  const confirm = useCallback(async () => {
    if (state.step === "working") return;
    dispatch({ type: "confirm" });
    try {
      await actions.discard(candidate.id, candidate.serverSeq);
      dispatch({ type: "done" });
      opts.onDone?.();
    } catch (error) {
      dispatch({ type: "fail", error });
    }
  }, [actions, candidate.id, candidate.serverSeq, opts, state.step]);
  return {
    open: state.step !== "idle",
    working: state.step === "working",
    error: state.step === "failed" ? state.error : null,
    words: discardWords(candidate, opts.count),
    ask,
    cancel,
    confirm,
  };
}
