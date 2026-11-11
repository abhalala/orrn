import type {
  ArtifactDetail,
  CandidateDetail,
  CandidateState,
  CandidateSummary,
  IngestStatus,
  MergeRunDetail,
  RowState,
  StagedRow,
} from "./types";

const notBuilt = (name: string): never => {
  throw new Error(`${name} is not built yet`);
};

export const ingestKeys = {
  all: ["ingest"] as const,
  status: () => ["ingest", "status"] as const,
  candidates: (state?: CandidateState) => ["ingest", "candidates", state ?? "all"] as const,
  candidate: (id: string) => ["ingest", "candidate", id] as const,
  rows: (id: string, state: RowState | "all", page: number) => ["ingest", "rows", id, state, page] as const,
  artifacts: () => ["ingest", "artifacts"] as const,
  artifact: (id: string) => ["ingest", "artifact", id] as const,
  run: (id: string) => ["ingest", "run", id] as const,
};

/** Shape of a TanStack query result, as far as the screens need it. */
export type Q<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
};

/** `ingest.status`: helper ready, storage ready, limits, the active run. Refreshes on focus. */
export function useIngestStatus(): Q<IngestStatus> {
  return notBuilt("useIngestStatus");
}

/** Candidates of the plant, newest first, all pages walked up to 500. Polls every 3 s while any is running. */
export function useCandidates(state?: CandidateState): Q<CandidateSummary[]> {
  void state;
  return notBuilt("useCandidates");
}

/** `candidate.get`. Polls every 3 s only while its state is `processing` or `merging`. */
export function useCandidate(candidateId: string | undefined): Q<CandidateDetail> {
  void candidateId;
  return notBuilt("useCandidate");
}

/** `rows.list`, 100 per page, `page` is 0-based. Rates arrive masked when the person lacks `order.price`. */
export function useRows(
  candidateId: string | undefined,
  opts: { state?: RowState; page: number },
): Q<{ items: StagedRow[]; hasNext: boolean }> {
  void candidateId;
  void opts;
  return notBuilt("useRows");
}

/** `artifact.get`: file facts, blocks, candidates. */
export function useArtifact(artifactId: string | undefined): Q<ArtifactDetail> {
  void artifactId;
  return notBuilt("useArtifact");
}

/** `merge.get`. Polls every 3 s only while the run is `planning` or `running`. */
export function useMergeRun(runId: string | undefined): Q<MergeRunDetail> {
  void runId;
  return notBuilt("useMergeRun");
}
