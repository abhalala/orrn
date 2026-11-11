import type { IngestTarget, RowDecision } from "./types";

const notBuilt = (name: string): never => {
  throw new Error(`${name} is not built yet`);
};

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
  answer: (candidateId: string, code: string, subject: string, answer: unknown, expectSeq: number) => Promise<void>;
  decide: (
    candidateId: string,
    rowIds: string[],
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

/** `rows.decide` takes 200 ids at most; `decide` splits a longer list into calls of 200. */
export const DECIDE_ROWS_PER_CALL = 200;

export function useIngestActions(): IngestActions {
  return notBuilt("useIngestActions");
}
