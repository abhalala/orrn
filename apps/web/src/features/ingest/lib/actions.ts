import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { chunk } from "./limits";
import { ingestKeys } from "./queries";
import { ingestApi } from "./trpc-api";
import type { BuiltAnswer } from "./answers";
import type { IngestTarget, RowDecision } from "./types";

/** `rows.decide` takes 200 ids at most; `decide` splits a longer list into calls of 200. */
export const DECIDE_ROWS_PER_CALL = 200;

/**
 * Every write the review and files screens make. Each function takes the candidate's current `serverSeq` as
 * `expectSeq`; a stale one rejects with CONFLICT, and `isConflict(error)` from `pump.ts` tells it. Each call
 * invalidates the candidate, the candidate lists and the artifact, so the screen reads fresh counters.
 */
export type IngestActions = {
  setTarget: (candidateId: string, target: IngestTarget | "ignore", expectSeq: number) => Promise<void>;
  /** "Use this layout" is `accept: true`, "Not this one" is `accept: false`. */
  confirmNear: (candidateId: string, accept: boolean, expectSeq: number) => Promise<void>;
  saveShape: (candidateId: string, recipe: unknown, holeName: string, expectSeq: number) => Promise<void>;
  /** `answer` comes from the builders below, so the shape is the one the server reads. */
  answer: (candidateId: string, subject: string, answer: BuiltAnswer, expectSeq: number) => Promise<void>;
  decide: (
    candidateId: string,
    rowIds: readonly string[],
    decision: RowDecision,
    expectSeq: number,
    matchId?: string,
  ) => Promise<void>;
  approve: (candidateId: string, expectSeq: number) => Promise<void>;
  hold: (candidateId: string, expectSeq: number, reason?: string) => Promise<void>;
  discard: (candidateId: string, expectSeq: number) => Promise<void>;
  confirmPeriod: (artifactId: string, fy: string | null, asOf: string | null) => Promise<void>;
  stopMerge: (runId: string) => Promise<void>;
  retireHole: (holeId: string) => Promise<void>;
};


/** Everything a candidate write can change: the candidate, every list, the rows and the files. */
export async function refreshIngest(qc: QueryClient, candidateId?: string): Promise<void> {
  const work: Promise<unknown>[] = [
    qc.invalidateQueries({ queryKey: ["ingest", "candidates"] }),
    qc.invalidateQueries({ queryKey: ["ingest", "artifact"] }),
    qc.invalidateQueries({ queryKey: ingestKeys.status() }),
  ];
  if (candidateId) {
    work.push(qc.invalidateQueries({ queryKey: ingestKeys.candidate(candidateId) }));
    work.push(qc.invalidateQueries({ queryKey: ingestKeys.rowsOf(candidateId) }));
  }
  await Promise.all(work);
}

/** The actions on a given query client and api, for tests. `useIngestActions` binds the app's. */
export function makeIngestActions(qc: QueryClient, api: () => ReturnType<typeof ingestApi> = ingestApi): IngestActions {
  const then = (candidateId?: string) => () => refreshIngest(qc, candidateId);
  return {
    setTarget: (candidateId, target, expectSeq) =>
      api().candidateSetTarget({ candidateId, target, expectSeq }).then(then(candidateId)),
    confirmNear: (candidateId, accept, expectSeq) =>
      api().candidateConfirmNear({ candidateId, accept, expectSeq }).then(then(candidateId)),
    saveShape: (candidateId, recipe, holeName, expectSeq) =>
      api().shapeSave({ candidateId, recipe, holeName, expectSeq }).then(then(candidateId)),
    answer: (candidateId, subject, built, expectSeq) =>
      api().answerSet({ candidateId, questionCode: built.code, subject, answer: built.answer, expectSeq }).then(then(candidateId)),
    decide: async (candidateId, rowIds, decision, expectSeq, matchId) => {
      let seq = expectSeq;
      for (const ids of chunk(rowIds, DECIDE_ROWS_PER_CALL)) {
        await api().rowsDecide({ candidateId, rowIds: ids, decision, matchId, expectSeq: seq });
        // The server moves `serverSeq` on every decide; later calls need the fresh value.
        if (rowIds.length > DECIDE_ROWS_PER_CALL) {
          const fresh = await api().candidateGet({ candidateId });
          seq = fresh.serverSeq;
        }
      }
      await refreshIngest(qc, candidateId);
    },
    approve: (candidateId, expectSeq) => api().candidateApprove({ candidateId, expectSeq }).then(then(candidateId)),
    hold: (candidateId, expectSeq, reason) =>
      api().candidateHold({ candidateId, reason, expectSeq }).then(then(candidateId)),
    discard: (candidateId, expectSeq) => api().candidateDiscard({ candidateId, expectSeq }).then(then(candidateId)),
    confirmPeriod: (artifactId, fy, asOf) => api().periodConfirm({ artifactId, fy, asOf }).then(then()),
    stopMerge: (runId) =>
      api().mergeStop({ runId }).then(() => qc.invalidateQueries({ queryKey: ingestKeys.run(runId) }).then(() => undefined)),
    retireHole: (holeId) => api().holeRetire({ holeId }).then(then()),
  };
}

export function useIngestActions(): IngestActions {
  const qc = useQueryClient();
  return useMemo(() => makeIngestActions(qc), [qc]);
}
