/**
 * Infinity Portal router (plan B5). Files come in, each table becomes a candidate, a person approves or
 * holds, and one merge writes every approved candidate through the existing procedures.
 *
 * Guards: U = `ingest.upload`, M = `ingest.merge`, R = either. Every mutation that changes a candidate
 * takes `expectSeq` and fails with CONFLICT when the candidate's `serverSeq` moved. The ingest router is
 * not in `ROUTER_MODULE`: it spans modules, and the merge inherits the gates of the procedures it calls.
 */
import { TRPCError } from "@trpc/server";

import { actionProcedure, anyActionProcedure, router } from "../../index";
import type {
  ArtifactBeginOut,
  ArtifactDetail,
  ArtifactSummary,
  CandidateCounts,
  CandidateDetail,
  CandidateSummary,
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

const U = actionProcedure("ingest.upload");
const M = actionProcedure("ingest.merge");
const R = anyActionProcedure("ingest.upload", "ingest.merge");

function todo(): never {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Imports are not built yet" });
}

export const ingestRouter = router({
  status: R.query(async (): Promise<IngestStatus> => todo()),

  artifact: router({
    begin: U.input(beginInput).mutation(async (): Promise<ArtifactBeginOut> => todo()),
    commitRaw: U.input(artifactIdInput).mutation(async (): Promise<{ vaultState: ArtifactSummary["vaultState"] }> => todo()),
    putBlocks: U.input(putBlocksInput).mutation(
      async (): Promise<{ blocks: { blockId: string; ordinal: number }[]; candidates: CandidateSummary[] }> => todo(),
    ),
    putRows: U.input(putRowsInput).mutation(async (): Promise<{ rowsPut: number }> => todo()),
    complete: U.input(artifactIdInput).mutation(
      async (): Promise<{ canonicalUploads: { blockOrdinal: number; url: string; ticket: string }[] }> => todo(),
    ),
    list: R.input(listInput).query(async (): Promise<Page<ArtifactSummary>> => todo()),
    get: R.input(artifactIdInput).query(async (): Promise<ArtifactDetail> => todo()),
  }),

  period: router({
    confirm: U.input(periodConfirmInput).mutation(async (): Promise<ArtifactSummary> => todo()),
  }),

  candidate: router({
    list: R.input(candidateListInput).query(async (): Promise<Page<CandidateSummary>> => todo()),
    get: R.input(candidateIdInput).query(async (): Promise<CandidateDetail> => todo()),
    setTarget: U.input(setTargetInput).mutation(async (): Promise<CandidateDetail> => todo()),
    confirmNear: U.input(confirmNearInput).mutation(async (): Promise<CandidateDetail> => todo()),
    approve: M.input(candidateSeqInput).mutation(async (): Promise<CandidateDetail> => todo()),
    hold: R.input(holdInput).mutation(async (): Promise<CandidateDetail> => todo()),
    discard: U.input(candidateSeqInput).mutation(async (): Promise<CandidateDetail> => todo()),
  }),

  shape: router({
    make: U.input(shapeMakeInput).mutation(async (): Promise<ShapeMakeOut> => todo()),
    save: U.input(shapeSaveInput).mutation(async (): Promise<CandidateDetail> => todo()),
  }),

  dryRun: router({
    step: U.input(dryRunStepInput).mutation(async (): Promise<DryRunStepOut> => todo()),
  }),

  rows: router({
    list: R.input(rowsListInput).query(async (): Promise<Page<StagedRowView>> => todo()),
    decide: U.input(rowsDecideInput).mutation(async (): Promise<CandidateCounts> => todo()),
  }),

  answer: router({
    set: U.input(answerSetInput).mutation(async (): Promise<CandidateDetail> => todo()),
  }),

  merge: router({
    start: M.mutation(async (): Promise<{ runId: string }> => todo()),
    step: M.input(mergeStepInput).mutation(async (): Promise<MergeStepOut> => todo()),
    get: R.input(runIdInput).query(async (): Promise<MergeRunView> => todo()),
    stop: M.input(runIdInput).mutation(async (): Promise<MergeStepOut> => todo()),
  }),

  hole: router({
    list: R.input(holeListInput).query(async (): Promise<HoleView[]> => todo()),
    retire: M.input(holeIdInput).mutation(async (): Promise<HoleView> => todo()),
  }),

  provenance: router({
    forRecord: R.input(provenanceInput).query(async (): Promise<ProvenanceOut> => todo()),
  }),
});
