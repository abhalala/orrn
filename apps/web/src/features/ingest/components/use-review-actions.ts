import type { Recipe } from "@orrn/ingest";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  ingestApi,
  isConflict,
  nextFocus,
  openQuestionTotal,
  refreshIngest,
  rowFocusKey,
  useIngestActions,
  useRunAction,
  type BuiltAnswer,
  type CandidateDetail,
  type DecisionOption,
  type useFocusReturn,
} from "../lib";

/**
 * Every write the review page makes, behind one lock (`useRunAction`: one write at a time, a second press does nothing).
 * A write that fails keeps its error with the part of the page it belongs to, so the words show next to the control the
 * person used and not at the top of a long page. After a write that went through, focus goes where the person was.
 *
 * The components get this as plain data and functions, so a test can hand them a stub.
 */
export type ReviewArea = "bar" | "questions" | "rows" | "year" | "shape";

/** Keys the page registers with `useFocusReturn`. */
export const FOCUS = {
  bar: "review:bar",
  after: "review:after",
  firstQuestion: "review:first-question",
  rowsHeading: "review:rows-heading",
  rowsFilter: "review:rows-filter",
  yearSelect: "review:year-select",
  yearChange: "review:year-change",
  changeMapping: "review:change-mapping",
  editorHeading: "review:editor-heading",
} as const;

export const questionFocusKey = (code: string, subject: string) => `review:question:${code}:${subject}`;
/** The key of a question's sentence, which takes focus when a row that waits on it links there. */
export const questionSentenceKey = (code: string, subject: string) => `review:question-text:${code}:${subject}`;

export type ReviewActions = {
  /** A write is running: every write button is `aria-disabled`. */
  busy: boolean;
  /** The name of the write running (`approve`, `row:<id>`, ...), for `aria-busy` on that button. */
  pending: string | null;
  /** The last failed write of this part of the page, or null. */
  failed: (area: ReviewArea) => unknown;
  /** After Approve or Hold: the line in the bar. `nonce` changes on every new one. */
  after: { kind: "approved" | "held" | "repicked"; nonce: number } | null;
  approve: () => Promise<boolean>;
  hold: (reason: string | undefined) => Promise<boolean>;
  release: () => Promise<boolean>;
  repick: () => Promise<boolean>;
  confirmNear: (accept: boolean) => Promise<boolean>;
  ignoreSheet: () => Promise<boolean>;
  answer: (subject: string, built: BuiltAnswer, focusKey: string) => Promise<boolean>;
  skipRows: (field: string, focusKey: string) => Promise<boolean>;
  decide: (row: { id: string; n: number }, option: DecisionOption, visibleIds: readonly string[]) => Promise<boolean>;
  saveYear: (fy: string | null, asOf: string | null) => Promise<boolean>;
  saveShape: (recipe: Recipe, name: string) => Promise<boolean>;
};

export function useReviewActions(input: {
  candidate: Pick<CandidateDetail, "id" | "artifactId" | "serverSeq">;
  focus: Pick<ReturnType<typeof useFocusReturn>, "request">;
  announce: (text: string) => void;
  /** `ingest.rows.decided` with the row number, said in the person's language. */
  decidedText: (n: number) => string;
}): ReviewActions {
  const { candidate, focus, announce, decidedText } = input;
  const actions = useIngestActions();
  const qc = useQueryClient();
  const runner = useRunAction();
  const [failure, setFailure] = useState<{ area: ReviewArea; error: unknown } | null>(null);
  const [after, setAfter] = useState<ReviewActions["after"]>(null);
  const nonce = useRef(0);
  const { id, artifactId, serverSeq } = candidate;

  const write = useCallback(
    async (area: ReviewArea, name: string, fn: () => Promise<unknown>): Promise<boolean> => {
      setFailure(null);
      let caught: unknown = null;
      const ok = await runner.run(
        name,
        async () => {
          try {
            await fn();
          } catch (error) {
            caught = error;
            throw error;
          }
        },
        { candidateId: id },
      );
      if (!ok && caught !== null) setFailure({ area, error: caught });
      return ok;
    },
    [runner, id],
  );

  return useMemo<ReviewActions>(() => ({
    busy: runner.busy,
    pending: runner.pending,
    failed: (area) => (failure && failure.area === area ? failure.error : null),
    after,
    approve: async () => {
      const ok = await write("bar", "approve", async () => {
        try {
          await actions.approve(id, serverSeq);
        } catch (error) {
          // The page showed Ready from the dry run's last answer while the server had moved the candidate once more (it
          // checks again by itself after another sheet changes). If, read afresh, it is still ready with nothing open,
          // the person's press stands: approve once more on the fresh number. Anything else is theirs to look at.
          if (!isConflict(error)) throw error;
          const fresh = await ingestApi().candidateGet({ candidateId: id });
          if (fresh.state !== "ready" || openQuestionTotal(fresh) > 0) throw error;
          await actions.approve(id, fresh.serverSeq);
        }
      });
      if (ok) {
        nonce.current += 1;
        setAfter({ kind: "approved", nonce: nonce.current });
        focus.request([FOCUS.after, FOCUS.bar]);
      }
      return ok;
    },
    hold: async (reason) => {
      const ok = await write("bar", "hold", () => actions.hold(id, serverSeq, reason));
      if (ok) {
        nonce.current += 1;
        setAfter({ kind: "held", nonce: nonce.current });
        focus.request([FOCUS.after, FOCUS.bar]);
      }
      return ok;
    },
    release: async () => {
      setAfter(null);
      const ok = await write("bar", "release", () => actions.release(id, serverSeq));
      if (ok) focus.request([FOCUS.bar]);
      return ok;
    },
    repick: async () => {
      const ok = await write("bar", "repick", () => actions.repickHeader(id, serverSeq));
      if (ok) {
        nonce.current += 1;
        setAfter({ kind: "repicked", nonce: nonce.current });
        focus.request([FOCUS.after, FOCUS.bar]);
      }
      return ok;
    },
    confirmNear: async (accept) => {
      const ok = await write("bar", accept ? "useLayout" : "rejectLayout", () => actions.confirmNear(id, accept, serverSeq));
      if (ok) focus.request([FOCUS.bar]);
      return ok;
    },
    ignoreSheet: async () => {
      const ok = await write("bar", "ignore", () => actions.setTarget(id, "ignore", serverSeq));
      if (ok) focus.request([FOCUS.bar]);
      return ok;
    },
    answer: async (subject, built, focusKey) => {
      const ok = await write("questions", `answer:${subject}`, () => actions.answer(id, subject, built, serverSeq));
      if (ok) focus.request([focusKey, FOCUS.firstQuestion, FOCUS.bar]);
      return ok;
    },
    skipRows: async (field, focusKey) => {
      const ok = await write("questions", `skip:${field}`, () => actions.skipFlaggedRows(id, field, serverSeq));
      if (ok) focus.request([focusKey, FOCUS.firstQuestion, FOCUS.bar]);
      return ok;
    },
    decide: async (row, option, visibleIds) => {
      const ok = await write("rows", `row:${row.id}`, () => actions.decide(id, [row.id], option.decision, serverSeq, option.matchId));
      if (ok) {
        announce(decidedText(row.n));
        const next = nextFocus(visibleIds, row.id);
        focus.request([rowFocusKey(row.id), ...(next ? [rowFocusKey(next)] : []), FOCUS.rowsFilter]);
      }
      return ok;
    },
    saveYear: async (fy, asOf) => {
      // The year belongs to the file, but this import's own read carries it too: refresh it so the saved line shows.
      const ok = await write("year", "year", async () => {
        await actions.confirmPeriod(artifactId, fy, asOf);
        await refreshIngest(qc, id);
      });
      if (ok) focus.request([FOCUS.yearChange, FOCUS.bar]);
      return ok;
    },
    saveShape: async (recipe, name) => {
      const ok = await write("shape", "shape", () => actions.saveShape(id, recipe, name, serverSeq));
      if (ok) focus.request([FOCUS.bar]);
      return ok;
    },
  }), [runner.busy, runner.pending, failure, after, write, actions, qc, id, artifactId, serverSeq, focus, announce, decidedText]);
}
