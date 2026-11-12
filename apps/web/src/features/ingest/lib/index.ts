/**
 * The logic of the Infinity Portal web screens: no markup. Read README.md (the contract with lane E2) first.
 */
export * from "./types";
export * from "./limits";
export * from "./model";
export {
  runPump, drivePump, runBotPump, BOT_MAX_CALLS, errorCodeOf, isConflict, isTransient, toPumpError, STALE_POLLS, STEP_RETRIES,
  type PumpError, type PumpOutcome, type PumpSpec, type PumpRead, type DriveSpec, type DriveOutcome,
} from "./pump";
export type { IngestApi } from "./api";
export { ingestApi, setIngestApiForTests } from "./trpc-api";
export * from "./queries";
export * from "./use-pumps";
export * from "./answers";
export { useIngestActions, makeIngestActions, refreshIngest, DECIDE_ROWS_PER_CALL, type IngestActions } from "./actions";
export { hashFile, readFile, ReadError, setReaderWorkerFactoryForTests, type ReadResult, type WorkerLike } from "./reader-client";
export type { ReadProgress, ReadFailure, ReadBlock } from "./reader-protocol";
export { useIngestUpload } from "./use-upload";
export { useReput, type ReputState } from "./use-reput";
export * from "./reput";
export * from "./header-step";
export * from "./files-model";
export {
  uploadOneFile, ticketUrl, gzipJsonl, problemFromError, UploadPutError,
  type UploadItem, type UploadStep, type ReadNote, readNotes, ReputError, type UploadReader, type UploadClientDeps,
} from "./upload";
export * from "./recipe-builder";
export * from "./errors";
export * from "./refusals";
export * from "./row-values";

// Work order of 2026-11-11: values, units and the view models of every screen.
export * from "./plant-units";
export { usePlantUnits } from "./use-plant-units";
export * from "./list-model";
export * from "./rows-model";
export * from "./review-model";
export * from "./mapping-model";
export * from "./merge-model";
export * from "./year-model";
export * from "./place";
export * from "./discard";
export { useRunAction } from "./use-run-action";
export { useDiscardFlow } from "./use-discard-flow";
export { useRowsBrowser } from "./use-rows-browser";
