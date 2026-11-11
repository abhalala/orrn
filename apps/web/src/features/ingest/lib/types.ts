/**
 * Infinity Portal web types. Shapes that cross the wire are the router's own, imported as types from the server
 * (erased at build, nothing from the server reaches the bundle). Enum lists come from `@orrn/ingest`. The screens
 * import everything from `./index`.
 */
import type {
  ArtifactBeginOut,
  ArtifactDetail,
  ArtifactSummary,
  BlockInput,
  BlockView,
  CandidateCounts,
  CandidateDetail,
  CandidateSummary,
  DryRunStepOut,
  HoleView,
  IngestLimits,
  IngestQuestion,
  IngestStatus,
  MergeCandidateResult,
  MergeChunkView,
  MergeRunView,
  MergeStepOut,
  Page,
  ShapeMakeOut,
  StagedRowView,
  UploadTicketOut,
} from "@orrn/server/lib/ingest/types";

export {
  ARTIFACT_KINDS,
  CANDIDATE_STATES,
  INGEST_TARGETS,
  QUESTION_CODES,
  ROW_DECISIONS,
  ROW_STATES,
} from "@orrn/ingest";
export type {
  ArtifactKind,
  BotOutcome,
  CandidateState,
  FitKind,
  IngestTarget,
  MergeRunState,
  QuestionCode,
  ReadState,
  RowDecision,
  RowMergeState,
  RowState,
  VaultState,
} from "@orrn/ingest";

export type {
  ArtifactBeginOut,
  ArtifactDetail,
  ArtifactSummary,
  BlockInput,
  BlockView,
  CandidateCounts,
  CandidateDetail,
  CandidateSummary,
  DryRunStepOut,
  HoleView,
  IngestLimits,
  IngestQuestion,
  IngestStatus,
  MergeCandidateResult,
  MergeChunkView,
  MergeRunView,
  MergeStepOut,
  Page,
  ShapeMakeOut,
  StagedRowView,
  UploadTicketOut,
};

export type BotNext = ShapeMakeOut["next"];
export type PeriodGuess = NonNullable<ArtifactSummary["period"]>;

/** What the near-fit card lists (plan B3). The server stores it loosely; `fitDiffView` reads it safely. */
export type FitDiff = {
  name: string | null;
  renamed: { old: string; new: string }[];
  extra: string[];
  missing: string[];
};
