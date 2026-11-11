import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";

import { candidatePollMs, isRunningCandidate, POLL_MS, runPollMs } from "./model";
import { ingestApi } from "./trpc-api";
import type {
  ArtifactDetail,
  CandidateDetail,
  CandidateState,
  CandidateSummary,
  IngestStatus,
  MergeRunView,
  RowState,
  StagedRowView,
} from "./types";
import { ROWS_PER_PAGE } from "./limits";

export const ingestKeys = {
  all: ["ingest"] as const,
  status: () => ["ingest", "status"] as const,
  candidates: (state?: CandidateState) => ["ingest", "candidates", state ?? "all"] as const,
  candidate: (id: string) => ["ingest", "candidate", id] as const,
  rows: (id: string, state: RowState | "all", page: number) => ["ingest", "rows", id, state, page] as const,
  rowsOf: (id: string) => ["ingest", "rows", id] as const,
  artifacts: () => ["ingest", "artifacts"] as const,
  artifact: (id: string) => ["ingest", "artifact", id] as const,
  run: (id: string) => ["ingest", "run", id] as const,
};

/** The result of a query hook: TanStack's own result (`data`, `isLoading`, `isError`, `refetch`, ...). */
export type Q<T> = UseQueryResult<T>;

/** `ingest.status`: helper ready, storage ready, limits, the active run. Refreshes on focus. */
export function useIngestStatus(): Q<IngestStatus> {
  return useQuery({
    queryKey: ingestKeys.status(),
    queryFn: () => ingestApi().status(),
    staleTime: 15_000,
    meta: INLINE_ERROR_META,
  });
}

/** Most candidates one list walks: 10 pages of 50. */
export const MAX_LISTED_CANDIDATES = 500;

/** Walks every page of `candidate.list`, up to `MAX_LISTED_CANDIDATES`. */
export async function listAllCandidates(state?: CandidateState, artifactId?: string): Promise<CandidateSummary[]> {
  const out: CandidateSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await ingestApi().candidateList({ state, artifactId, cursor, limit: 50 });
    out.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && out.length < MAX_LISTED_CANDIDATES);
  return out;
}

/** Candidates of the plant, newest first. Polls every 3 s while any of them is running. */
export function useCandidates(state?: CandidateState): Q<CandidateSummary[]> {
  return useQuery({
    queryKey: ingestKeys.candidates(state),
    queryFn: () => listAllCandidates(state),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((c) => isRunningCandidate(c.state)) ? POLL_MS : false,
    meta: INLINE_ERROR_META,
  });
}

/** `candidate.get`. Polls every 3 s only while its state is `processing` or `merging`. */
export function useCandidate(candidateId: string | undefined): Q<CandidateDetail> {
  return useQuery({
    queryKey: ingestKeys.candidate(candidateId ?? ""),
    queryFn: () => ingestApi().candidateGet({ candidateId: candidateId! }),
    enabled: Boolean(candidateId),
    refetchInterval: (query) => candidatePollMs(query.state.data?.state),
    meta: INLINE_ERROR_META,
  });
}

/** The cursor that opens each page, learned as pages load: `rows.list` pages by cursor, the screen by number. */
const pageCursors = new Map<string, string | undefined>();
const pageKey = (id: string, state: RowState | undefined, page: number) => `${id}|${state ?? "all"}|${page}`;

/** Cursor for `page`, walking forward from the nearest page whose cursor is known. */
async function cursorForPage(id: string, state: RowState | undefined, page: number): Promise<string | undefined> {
  if (page === 0) return undefined;
  if (pageCursors.has(pageKey(id, state, page))) return pageCursors.get(pageKey(id, state, page));
  let known = page - 1;
  while (known > 0 && !pageCursors.has(pageKey(id, state, known))) known -= 1;
  let cursor = pageCursors.get(pageKey(id, state, known));
  for (let p = known; p < page; p += 1) {
    const walked = await ingestApi().rowsList({ candidateId: id, state, cursor, limit: ROWS_PER_PAGE });
    cursor = walked.nextCursor ?? undefined;
    pageCursors.set(pageKey(id, state, p + 1), cursor);
    if (cursor === undefined) break;
  }
  return cursor;
}

/** `rows.list`, 100 per page, `page` is 0-based. Rates arrive masked when the person lacks `order.price`. */
export function useRows(
  candidateId: string | undefined,
  opts: { state?: RowState; page: number },
): Q<{ items: StagedRowView[]; hasNext: boolean }> {
  return useQuery({
    queryKey: ingestKeys.rows(candidateId ?? "", opts.state ?? "all", opts.page),
    queryFn: async () => {
      const cursor = await cursorForPage(candidateId!, opts.state, opts.page);
      const result = await ingestApi().rowsList({ candidateId: candidateId!, state: opts.state, cursor, limit: ROWS_PER_PAGE });
      pageCursors.set(pageKey(candidateId!, opts.state, opts.page + 1), result.nextCursor ?? undefined);
      return { items: result.items, hasNext: result.nextCursor !== null };
    },
    enabled: Boolean(candidateId),
    meta: INLINE_ERROR_META,
  });
}

/** `artifact.get`: file facts, blocks, candidates. Polls while the file is being read or a candidate is running. */
export function useArtifact(artifactId: string | undefined): Q<ArtifactDetail> {
  return useQuery({
    queryKey: ingestKeys.artifact(artifactId ?? ""),
    queryFn: () => ingestApi().artifactGet({ artifactId: artifactId! }),
    enabled: Boolean(artifactId),
    refetchInterval: (query) => {
      const a = query.state.data;
      if (!a) return false;
      const running = a.readState === "reading" || a.blocks.some((b) => b.candidates.some((c) => isRunningCandidate(c.state)));
      return running ? POLL_MS : false;
    },
    meta: INLINE_ERROR_META,
  });
}

/** `merge.get`. Polls every 3 s only while the run is `planning` or `running`. */
export function useMergeRun(runId: string | undefined): Q<MergeRunView> {
  return useQuery({
    queryKey: ingestKeys.run(runId ?? ""),
    queryFn: () => ingestApi().mergeGet({ runId: runId! }),
    enabled: Boolean(runId),
    refetchInterval: (query) => runPollMs(query.state.data?.state),
    meta: INLINE_ERROR_META,
  });
}
