import { trpcClient } from "@/shared/utils/trpc";

import type { IngestApi } from "./api";

let override: IngestApi | null = null;
let real: IngestApi | null = null;

function build(): IngestApi {
  const c = trpcClient.ingest;
  return {
    status: () => c.status.query(),
    artifactBegin: (i) => c.artifact.begin.mutate(i),
    artifactCommitRaw: (i) => c.artifact.commitRaw.mutate(i),
    artifactPutBlocks: (i) => c.artifact.putBlocks.mutate(i),
    artifactPutRows: (i) => c.artifact.putRows.mutate(i),
    artifactComplete: (i) => c.artifact.complete.mutate(i),
    artifactList: (i) => c.artifact.list.query(i),
    artifactGet: (i) => c.artifact.get.query(i),
    periodConfirm: (i) => c.period.confirm.mutate(i),
    candidateList: (i) => c.candidate.list.query(i),
    candidateGet: (i) => c.candidate.get.query(i),
    candidateSetTarget: (i) => c.candidate.setTarget.mutate(i),
    candidateConfirmNear: (i) => c.candidate.confirmNear.mutate(i),
    candidateApprove: (i) => c.candidate.approve.mutate(i),
    candidateHold: (i) => c.candidate.hold.mutate(i),
    candidateRelease: (i) => c.candidate.release.mutate(i),
    candidateRepickHeader: (i) => c.candidate.repickHeader.mutate(i),
    candidateDiscard: (i) => c.candidate.discard.mutate(i),
    shapeMake: (i) => c.shape.make.mutate(i),
    shapeSave: (i) => c.shape.save.mutate(i),
    dryRunStep: (i) => c.dryRun.step.mutate(i),
    rowsList: (i) => c.rows.list.query(i),
    rowsDecide: (i) => c.rows.decide.mutate(i),
    answerSet: (i) => c.answer.set.mutate(i),
    mergeStart: () => c.merge.start.mutate(),
    mergeStep: (i) => c.merge.step.mutate(i),
    mergeGet: (i) => c.merge.get.query(i),
    mergeStop: (i) => c.merge.stop.mutate(i),
    holeList: (i) => c.hole.list.query(i),
    holeRetire: (i) => c.hole.retire.mutate(i),
    provenanceForRecord: (i) => c.provenance.forRecord.query(i),
  };
}

/** The app's `IngestApi`, on the same tRPC client every other feature uses. */
export function ingestApi(): IngestApi {
  if (override) return override;
  real ??= build();
  return real;
}

/** For tests: replace the api, or pass null to reset. */
export function setIngestApiForTests(api: IngestApi | null): void {
  override = api;
}
