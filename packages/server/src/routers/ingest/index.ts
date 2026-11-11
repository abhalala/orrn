/**
 * Infinity Portal router (plan B5). Files come in, each table becomes a candidate, a person approves or
 * holds, and one merge writes every approved candidate through the existing procedures.
 *
 * Guards: U = `ingest.upload`, M = `ingest.merge`, R = either. Every mutation that changes a candidate
 * takes `expectSeq` and fails with CONFLICT when the candidate's `serverSeq` moved. The ingest router is
 * not in `ROUTER_MODULE`: it spans modules, and the merge inherits the gates of the procedures it calls.
 */
import { actionProcedure, anyActionProcedure, router } from "../../index";
import type {
  ArtifactBeginOut,
  ArtifactDetail,
  ArtifactSummary,
  CandidateCounts,
  CandidateDetail,
  CandidateSummary,
  HeaderAnswer,
  DryRunStepOut,
  HoleView,
  IngestStatus,
  MergeRunView,
  MergeStepOut,
  Page,
  ProvenanceOut,
  ShapeMakeOut,
  StagedRowView,
} from "../../lib/ingest/types";
import {
  answerSetInput,
  artifactIdInput,
  beginInput,
  candidateIdInput,
  candidateListInput,
  candidateSeqInput,
  completeInput,
  confirmNearInput,
  dryRunStepInput,
  holdInput,
  holeIdInput,
  holeListInput,
  listInput,
  mergeStepInput,
  periodConfirmInput,
  provenanceInput,
  putBlocksInput,
  putRowsInput,
  rowsDecideInput,
  rowsListInput,
  runIdInput,
  setTargetInput,
  shapeMakeInput,
  shapeSaveInput,
} from "./inputs";
import {
  beginArtifact,
  commitRaw,
  completeArtifact,
  confirmPeriod,
  getArtifact,
  ingestStatus,
  listArtifacts,
  putRows,
} from "../../lib/ingest/artifacts";
import {
  approveCandidate,
  candidateDetail,
  confirmNear,
  decideRows,
  discardCandidate,
  holdCandidate,
  listCandidates,
  listHoles,
  listRows,
  makeShape,
  mergeRunView,
  provenanceFor,
  putBlocks,
  releaseCandidate,
  retireHole,
  saveShape,
  setAnswer,
  setTarget,
} from "../../lib/ingest/candidates";
import { dryRunStep } from "../../lib/ingest/dryrun";
import { mergeEngine } from "../../lib/ingest/engines";
import type { IngestCtx } from "../../lib/ingest/types";

const U = actionProcedure("ingest.upload");
const M = actionProcedure("ingest.merge");
const R = anyActionProcedure("ingest.upload", "ingest.merge");

/** The guarded procedure context, narrowed to what the ingest libraries take. */
function ix(ctx: IngestCtx): IngestCtx {
  return ctx;
}

export const ingestRouter = router({
  status: R.query(({ ctx }): Promise<IngestStatus> => ingestStatus(ix(ctx))),

  artifact: router({
    begin: U.input(beginInput).mutation(({ ctx, input }): Promise<ArtifactBeginOut> => beginArtifact(ix(ctx), input)),
    commitRaw: U.input(artifactIdInput).mutation(
      ({ ctx, input }): Promise<{ vaultState: ArtifactSummary["vaultState"] }> => commitRaw(ix(ctx), input.artifactId),
    ),
    putBlocks: U.input(putBlocksInput).mutation(
      ({ ctx, input }): Promise<{ blocks: { blockId: string; ordinal: number }[]; candidates: CandidateSummary[]; header: HeaderAnswer[] }> =>
        putBlocks(ix(ctx), input),
    ),
    putRows: U.input(putRowsInput).mutation(({ ctx, input }): Promise<{ rowsPut: number }> => putRows(ix(ctx), input)),
    complete: U.input(completeInput).mutation(
      ({ ctx, input }): Promise<{ canonicalUploads: { blockOrdinal: number; url: string; ticket: string }[] }> =>
        completeArtifact(ix(ctx), input),
    ),
    list: R.input(listInput).query(({ ctx, input }): Promise<Page<ArtifactSummary>> => listArtifacts(ix(ctx), input)),
    get: R.input(artifactIdInput).query(({ ctx, input }): Promise<ArtifactDetail> => getArtifact(ix(ctx), input.artifactId)),
  }),

  period: router({
    confirm: U.input(periodConfirmInput).mutation(({ ctx, input }): Promise<ArtifactSummary> => confirmPeriod(ix(ctx), input)),
  }),

  candidate: router({
    list: R.input(candidateListInput).query(({ ctx, input }): Promise<Page<CandidateSummary>> => listCandidates(ix(ctx), input)),
    get: R.input(candidateIdInput).query(({ ctx, input }): Promise<CandidateDetail> => candidateDetail(ix(ctx), input.candidateId)),
    setTarget: U.input(setTargetInput).mutation(({ ctx, input }): Promise<CandidateDetail> => setTarget(ix(ctx), input)),
    confirmNear: U.input(confirmNearInput).mutation(({ ctx, input }): Promise<CandidateDetail> => confirmNear(ix(ctx), input)),
    approve: M.input(candidateSeqInput).mutation(({ ctx, input }): Promise<CandidateDetail> => approveCandidate(ix(ctx), input)),
    hold: R.input(holdInput).mutation(({ ctx, input }): Promise<CandidateDetail> => holdCandidate(ix(ctx), input)),
    /** Held back to checking rows (A15): processing from the first open row, then ready. */
    release: R.input(candidateSeqInput).mutation(({ ctx, input }): Promise<CandidateDetail> => releaseCandidate(ix(ctx), input)),
    discard: U.input(candidateSeqInput).mutation(({ ctx, input }): Promise<CandidateDetail> => discardCandidate(ix(ctx), input)),
  }),

  shape: router({
    make: U.input(shapeMakeInput).mutation(({ ctx, input }): Promise<ShapeMakeOut> => makeShape(ix(ctx), input)),
    save: U.input(shapeSaveInput).mutation(({ ctx, input }): Promise<CandidateDetail> => saveShape(ix(ctx), input)),
  }),

  dryRun: router({
    step: U.input(dryRunStepInput).mutation(({ ctx, input }): Promise<DryRunStepOut> => dryRunStep(ix(ctx), input)),
  }),

  rows: router({
    list: R.input(rowsListInput).query(({ ctx, input }): Promise<Page<StagedRowView>> => listRows(ix(ctx), input)),
    decide: U.input(rowsDecideInput).mutation(({ ctx, input }): Promise<CandidateCounts> => decideRows(ix(ctx), input)),
  }),

  answer: router({
    set: U.input(answerSetInput).mutation(({ ctx, input }): Promise<CandidateDetail> => setAnswer(ix(ctx), input)),
  }),

  merge: router({
    start: M.mutation(({ ctx }): Promise<{ runId: string }> => mergeEngine.startMerge(ix(ctx))),
    step: M.input(mergeStepInput).mutation(({ ctx, input }): Promise<MergeStepOut> => mergeEngine.stepMerge(ix(ctx), input)),
    get: R.input(runIdInput).query(({ ctx, input }): Promise<MergeRunView> => mergeRunView(ix(ctx), input.runId)),
    stop: M.input(runIdInput).mutation(({ ctx, input }): Promise<MergeStepOut> => mergeEngine.stopMerge(ix(ctx), input)),
  }),

  hole: router({
    list: R.input(holeListInput).query(({ ctx, input }): Promise<HoleView[]> => listHoles(ix(ctx), input)),
    retire: M.input(holeIdInput).mutation(({ ctx, input }): Promise<HoleView> => retireHole(ix(ctx), input)),
  }),

  provenance: router({
    forRecord: R.input(provenanceInput).query(({ ctx, input }): Promise<ProvenanceOut> => provenanceFor(ix(ctx), input)),
  }),
});
