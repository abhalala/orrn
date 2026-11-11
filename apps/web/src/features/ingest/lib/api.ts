import { trpcClient } from "@/shared/utils/trpc";

import type {
  ArtifactDetail,
  ArtifactSummary,
  BeginResult,
  BlockInput,
  CandidateDetail,
  CandidateState,
  CandidateStepResult,
  CandidateSummary,
  IngestStatus,
  IngestTarget,
  MergeRunDetail,
  MergeStepResult,
  RowDecision,
  RowState,
  ShapeMakeResult,
  StagedRow,
  UploadTicket,
  ArtifactKind,
} from "./types";

/**
 * The `ingest` router as the web calls it (plan B5), one async function per procedure. Until `portal/A-core` is
 * merged the router is not in `AppRouter`, so the client is cast here and only here. After the merge the cast is
 * replaced by the real typed client and this interface becomes a compile-time check against the router.
 */
export type IngestApi = {
  status: () => Promise<IngestStatus>;
  artifactBegin: (input: {
    sha256: string; fileName: string; sizeBytes: number; contentType: string; kind: ArtifactKind; note?: string;
  }) => Promise<BeginResult>;
  artifactCommitRaw: (input: { artifactId: string }) => Promise<{ vaultState: "pending" | "stored" | "not_stored" }>;
  artifactPutBlocks: (input: { artifactId: string; blocks: BlockInput[] }) => Promise<{
    blocks: { blockId: string; ordinal: number }[];
    candidates: CandidateSummary[];
  }>;
  artifactPutRows: (input: { blockId: string; fromIndex: number; expectRowsPut: number; rows: string[][] }) => Promise<{ rowsPut: number }>;
  artifactComplete: (input: { artifactId: string }) => Promise<{
    canonicalUploads: { blockOrdinal: number; url: string; ticket: string }[];
  }>;
  artifactList: (input: { cursor?: string; limit?: number }) => Promise<{ items: ArtifactSummary[]; nextCursor: string | null }>;
  artifactGet: (input: { artifactId: string }) => Promise<ArtifactDetail>;
  periodConfirm: (input: { artifactId: string; fy: string | null; asOf: string | null }) => Promise<ArtifactSummary>;
  candidateList: (input: { state?: CandidateState; cursor?: string; limit?: number }) => Promise<{
    items: CandidateSummary[]; nextCursor: string | null;
  }>;
  candidateGet: (input: { candidateId: string }) => Promise<CandidateDetail>;
  candidateSetTarget: (input: { candidateId: string; target: IngestTarget | "ignore"; expectSeq: number }) => Promise<CandidateSummary>;
  candidateConfirmNear: (input: { candidateId: string; accept: boolean; expectSeq: number }) => Promise<CandidateSummary>;
  shapeMake: (input: { candidateId: string; expectSeq: number }) => Promise<ShapeMakeResult>;
  shapeSave: (input: { candidateId: string; recipe: unknown; holeName: string; expectSeq: number }) => Promise<CandidateSummary>;
  dryRunStep: (input: { candidateId: string; expectCursor: number | null }) => Promise<CandidateStepResult>;
  rowsList: (input: { candidateId: string; state?: RowState; cursor?: string; limit?: number }) => Promise<{
    items: StagedRow[]; nextCursor: string | null;
  }>;
  answerSet: (input: {
    candidateId: string; questionCode: string; subject: string; answer: unknown; expectSeq: number;
  }) => Promise<CandidateSummary>;
  rowsDecide: (input: {
    candidateId: string; rowIds: string[]; decision: RowDecision; matchId?: string; expectSeq: number;
  }) => Promise<unknown>;
  candidateApprove: (input: { candidateId: string; expectSeq: number }) => Promise<CandidateSummary>;
  candidateHold: (input: { candidateId: string; reason?: string; expectSeq: number }) => Promise<CandidateSummary>;
  candidateDiscard: (input: { candidateId: string; expectSeq: number }) => Promise<CandidateSummary>;
  mergeStart: () => Promise<{ runId: string }>;
  mergeStep: (input: { runId: string; expectCursor: number | null }) => Promise<MergeStepResult>;
  mergeGet: (input: { runId: string }) => Promise<MergeRunDetail>;
  mergeStop: (input: { runId: string }) => Promise<unknown>;
  holeRetire: (input: { holeId: string }) => Promise<unknown>;
};

/** Path to a procedure on the untyped client: ["artifact", "begin"] calls `ingest.artifact.begin`. */
type Proc = { query?: (input?: unknown) => Promise<unknown>; mutate?: (input?: unknown) => Promise<unknown> };
type Node = Record<string, Record<string, Proc> | Proc>;

function proc(root: Node, path: readonly [string, string?]): Proc {
  const first = root[path[0]] as Record<string, Proc> | Proc | undefined;
  const node = path[1] === undefined ? (first as Proc | undefined) : (first as Record<string, Proc> | undefined)?.[path[1]];
  if (!node) throw new Error(`ingest.${path.join(".")} is not on the router`);
  return node;
}

/** Wraps a tRPC client (anything shaped like the `ingest` router) as an `IngestApi`. */
export function makeIngestApi(root: Node): IngestApi {
  const q = (path: readonly [string, string?]) => (input?: unknown) => proc(root, path).query!(input);
  const m = (path: readonly [string, string?]) => (input?: unknown) => proc(root, path).mutate!(input);
  return {
    status: q(["status"]),
    artifactBegin: m(["artifact", "begin"]),
    artifactCommitRaw: m(["artifact", "commitRaw"]),
    artifactPutBlocks: m(["artifact", "putBlocks"]),
    artifactPutRows: m(["artifact", "putRows"]),
    artifactComplete: m(["artifact", "complete"]),
    artifactList: q(["artifact", "list"]),
    artifactGet: q(["artifact", "get"]),
    periodConfirm: m(["period", "confirm"]),
    candidateList: q(["candidate", "list"]),
    candidateGet: q(["candidate", "get"]),
    candidateSetTarget: m(["candidate", "setTarget"]),
    candidateConfirmNear: m(["candidate", "confirmNear"]),
    shapeMake: m(["shape", "make"]),
    shapeSave: m(["shape", "save"]),
    dryRunStep: m(["dryRun", "step"]),
    rowsList: q(["rows", "list"]),
    answerSet: m(["answer", "set"]),
    rowsDecide: m(["rows", "decide"]),
    candidateApprove: m(["candidate", "approve"]),
    candidateHold: m(["candidate", "hold"]),
    candidateDiscard: m(["candidate", "discard"]),
    mergeStart: m(["merge", "start"]),
    mergeStep: m(["merge", "step"]),
    mergeGet: q(["merge", "get"]),
    mergeStop: m(["merge", "stop"]),
    holeRetire: m(["hole", "retire"]),
  } as IngestApi;
}

let shared: IngestApi | null = null;

/** The app's `IngestApi`, on the same tRPC client every other feature uses. */
export function ingestApi(): IngestApi {
  shared ??= makeIngestApi((trpcClient as unknown as { ingest: Node }).ingest);
  return shared;
}

/** For tests: replace the shared api, or pass null to reset. */
export function setIngestApiForTests(api: IngestApi | null): void {
  shared = api;
}

export type { UploadTicket };
