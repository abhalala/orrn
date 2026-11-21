/**
 * Infinity Portal router (plan B5). Files come in, each table becomes a candidate, a person approves or
 * holds, and one merge writes every approved candidate through the existing procedures.
 *
 * Guards: U = `ingest.upload`, M = `ingest.merge`, R = either. K = `ingest.check` (item 16, owner decision "Price-viewers
 * tick, admin approves"): the tick; V = any of the three, for the review reads a checker needs (`candidate.get`,
 * `rows.list`, the page image, the waiting list). A caller with only `ingest.check` is held to model-read tables there
 * (`check-scope.ts`). Every mutation that changes a candidate
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
  DoubtListOut,
  DryRunStepOut,
  HoleView,
  IngestStatus,
  MergeRunView,
  MergeStepOut,
  Page,
  ProvenanceOut,
  ShapeMakeOut,
  StagedRowView,
  VisionPagesOut,
  VisionPageView,
  VisionReadUrlOut,
  VisionStartOut,
  VisionBandTicketsOut,
} from "../../lib/ingest/types";
import {
  answerSetInput,
  artifactIdInput,
  beginInput,
  uploadStartInput,
  uploadTicketsInput,
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
  rowsDoubtsInput,
  rowsAnswerDoubtsInput,
  rowsListInput,
  runIdInput,
  setTargetInput,
  shapeMakeInput,
  shapeSaveInput,
  visionCheckInput,
  visionFixCellInput,
  visionBandTicketsInput,
  visionPageInput,
  visionReadPageInput,
  visionReadUrlInput,
  visionStartInput,
  visionTypePageInput,
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
  skipNoDateLines,
  listDoubts,
  answerDoubts,
  discardCandidate,
  holdCandidate,
  listCandidates,
  listHoles,
  listRows,
  makeShape,
  mergeRunView,
  provenanceFor,
  putBlocks,
  repickHeader,
  releaseCandidate,
  retireHole,
  saveShape,
  setAnswer,
  setTarget,
  visionCheck,
  visionFixCell,
} from "../../lib/ingest/candidates";
import { dryRunStep } from "../../lib/ingest/dryrun";
import { uploadAbort, uploadComplete, uploadStart, uploadTickets, type PartTicketOut, type UploadStartOut } from "../../lib/ingest/upload-parts";
import { visionBandTickets, visionFinishRest, visionNextBatch, visionPages, visionReadPage, visionReadUrl, visionSkipPage, visionStart, visionTypePage } from "../../lib/ingest/vision";
import { mergeEngine } from "../../lib/ingest/engines";
import { assertCheckable, assertCheckableRead, visionWaiting, type VisionWaitingItem } from "../../lib/ingest/check-scope";
import type { IngestCtx } from "../../lib/ingest/types";

const U = actionProcedure("ingest.upload");
const M = actionProcedure("ingest.merge");
const R = anyActionProcedure("ingest.upload", "ingest.merge");
const K = actionProcedure("ingest.check");
const V = anyActionProcedure("ingest.upload", "ingest.merge", "ingest.check");

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
    /** Chunked upload (limits brief part B): a file over one part goes to the vault in parts, each checked by its digest. */
    uploadStart: U.input(uploadStartInput).mutation(({ ctx, input }): Promise<UploadStartOut> => uploadStart(ix(ctx), input)),
    uploadTickets: U.input(uploadTicketsInput).mutation(({ ctx, input }): Promise<{ tickets: PartTicketOut[] }> => uploadTickets(ix(ctx), input)),
    uploadComplete: U.input(artifactIdInput).mutation(
      ({ ctx, input }): Promise<{ vaultState: ArtifactSummary["vaultState"] }> => uploadComplete(ix(ctx), input.artifactId),
    ),
    uploadAbort: U.input(artifactIdInput).mutation(({ ctx, input }): Promise<{ aborted: boolean }> => uploadAbort(ix(ctx), input.artifactId)),
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
    get: V.input(candidateIdInput).query(async ({ ctx, input }): Promise<CandidateDetail> => {
      await assertCheckable(ix(ctx), input.candidateId);
      return candidateDetail(ix(ctx), input.candidateId);
    }),
    setTarget: U.input(setTargetInput).mutation(({ ctx, input }): Promise<CandidateDetail> => setTarget(ix(ctx), input)),
    confirmNear: U.input(confirmNearInput).mutation(({ ctx, input }): Promise<CandidateDetail> => confirmNear(ix(ctx), input)),
    approve: M.input(candidateSeqInput).mutation(({ ctx, input }): Promise<CandidateDetail> => approveCandidate(ix(ctx), input)),
    hold: R.input(holdInput).mutation(({ ctx, input }): Promise<CandidateDetail> => holdCandidate(ix(ctx), input)),
    /** Held back to checking rows (A15): processing from the first open row, then ready. */
    release: R.input(candidateSeqInput).mutation(({ ctx, input }): Promise<CandidateDetail> => releaseCandidate(ix(ctx), input)),
    discard: U.input(candidateSeqInput).mutation(({ ctx, input }): Promise<CandidateDetail> => discardCandidate(ix(ctx), input)),
    /** Rule 7.2, "Wrong columns? Pick the row": back to the header pick, for a sheet with no row written. */
    repickHeader: U.input(candidateSeqInput).mutation(({ ctx, input }): Promise<{ artifactId: string; ordinal: number }> => repickHeader(ix(ctx), input)),
  }),

  shape: router({
    make: U.input(shapeMakeInput).mutation(({ ctx, input }): Promise<ShapeMakeOut> => makeShape(ix(ctx), input)),
    save: U.input(shapeSaveInput).mutation(({ ctx, input }): Promise<CandidateDetail> => saveShape(ix(ctx), input)),
  }),

  /**
   * Vision read (release 2): a PDF or photo read page by page with the vision model. The person types or
   * skips a page that is not read, and ticks each model-read table against its page before approval.
   */
  vision: router({
    start: U.input(visionStartInput).mutation(({ ctx, input }): Promise<VisionStartOut> => visionStart(ix(ctx), input)),
    /** Batches (contract section 12): plan the next pages and hand their tickets. */
    nextBatch: U.input(artifactIdInput).mutation(({ ctx, input }): Promise<VisionStartOut> => visionNextBatch(ix(ctx), input)),
    /** Skip the planned pages not settled and leave the pages past the plan not read, so the file can finish. */
    finishRest: U.input(artifactIdInput).mutation(({ ctx, input }): Promise<VisionPagesOut> => visionFinishRest(ix(ctx), input)),
    readPage: U.input(visionReadPageInput).mutation(({ ctx, input }): Promise<VisionPageView> => visionReadPage(ix(ctx), input)),
    bandTickets: U.input(visionBandTicketsInput).mutation(({ ctx, input }): Promise<VisionBandTicketsOut> => visionBandTickets(ix(ctx), input)),
    pages: R.input(artifactIdInput).query(({ ctx, input }): Promise<VisionPagesOut> => visionPages(ix(ctx), input)),
    skipPage: U.input(visionPageInput).mutation(({ ctx, input }): Promise<VisionPageView> => visionSkipPage(ix(ctx), input)),
    typePage: U.input(visionTypePageInput).mutation(({ ctx, input }): Promise<VisionPageView> => visionTypePage(ix(ctx), input)),
    readUrl: V.input(visionReadUrlInput).query(async ({ ctx, input }): Promise<VisionReadUrlOut> => {
      await assertCheckableRead(ix(ctx), input);
      return visionReadUrl(ix(ctx), input);
    }),
    // Item 16: the tick takes ingest.check (a price column also takes order.price, in visionCheck). Approve keeps M.
    check: K.input(visionCheckInput).mutation(async ({ ctx, input }): Promise<CandidateDetail> => {
      await assertCheckable(ix(ctx), input.candidateId);
      return visionCheck(ix(ctx), input);
    }),
    /** Item 16: "Tables waiting for a check", read only. */
    waiting: V.query(({ ctx }): Promise<VisionWaitingItem[]> => visionWaiting(ix(ctx))),
    fixCell: U.input(visionFixCellInput).mutation(({ ctx, input }): Promise<CandidateDetail> => visionFixCell(ix(ctx), input)),
  }),

  dryRun: router({
    step: U.input(dryRunStepInput).mutation(({ ctx, input }): Promise<DryRunStepOut> => dryRunStep(ix(ctx), input)),
  }),

  rows: router({
    list: V.input(rowsListInput).query(async ({ ctx, input }): Promise<Page<StagedRowView>> => {
      await assertCheckable(ix(ctx), input.candidateId);
      return listRows(ix(ctx), input);
    }),
    decide: U.input(rowsDecideInput).mutation(({ ctx, input }): Promise<CandidateCounts> => decideRows(ix(ctx), input)),
    // Rule 11.2: "Skip these {count} lines", every line of the sheet refused for a missing date.
    skipNoDate: U.input(candidateSeqInput).mutation(({ ctx, input }): Promise<{ skipped: number; counts: CandidateCounts }> => skipNoDateLines(ix(ctx), input)),
    doubts: R.input(rowsDoubtsInput).query(({ ctx, input }): Promise<DoubtListOut> => listDoubts(ix(ctx), input)),
    answerDoubts: U.input(rowsAnswerDoubtsInput).mutation(({ ctx, input }): Promise<CandidateCounts> => answerDoubts(ix(ctx), input)),
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
