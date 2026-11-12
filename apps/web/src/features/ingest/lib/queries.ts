import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";

import { candidatePollMs, isRunningCandidate, POLL_MS, runPollMs } from "./model";
import { ingestApi } from "./trpc-api";
import type {
  ArtifactDetail,
  ArtifactSummary,
  CandidateDetail,
  CandidateState,
  CandidateSummary,
  IngestStatus,
  MergeRunView,
  RowState,
  StagedRowView,
} from "./types";
import { ROWS_PER_PAGE } from "./limits";
import { ROWS_UI_PAGE, serverStatesFor, type RowFilter } from "./rows-model";

export const ingestKeys = {
  all: ["ingest"] as const,
  status: () => ["ingest", "status"] as const,
  candidates: (state?: CandidateState) => ["ingest", "candidates", state ?? "all"] as const,
  candidate: (id: string) => ["ingest", "candidate", id] as const,
  rows: (id: string, state: RowState | "all", page: number, size: number = ROWS_PER_PAGE) => ["ingest", "rows", id, state, page, size] as const,
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
const pageKey = (id: string, state: RowState | undefined, page: number, size: number) => `${id}|${state ?? "all"}|${size}|${page}`;

/** Forget the learned cursors of a candidate. A decision moves rows out of a filter, so the old page edges are wrong. */
export function forgetPageCursors(candidateId: string): void {
  for (const key of [...pageCursors.keys()]) if (key.startsWith(`${candidateId}|`)) pageCursors.delete(key);
}

/** Cursor for `page`, walking forward from the nearest page whose cursor is known. */
async function cursorForPage(id: string, state: RowState | undefined, page: number, size: number): Promise<string | undefined> {
  if (page === 0) return undefined;
  if (pageCursors.has(pageKey(id, state, page, size))) return pageCursors.get(pageKey(id, state, page, size));
  let known = page - 1;
  while (known > 0 && !pageCursors.has(pageKey(id, state, known, size))) known -= 1;
  let cursor = pageCursors.get(pageKey(id, state, known, size));
  for (let p = known; p < page; p += 1) {
    const walked = await ingestApi().rowsList({ candidateId: id, state, cursor, limit: size });
    cursor = walked.nextCursor ?? undefined;
    pageCursors.set(pageKey(id, state, p + 1, size), cursor);
    if (cursor === undefined) break;
  }
  return cursor;
}

/** `rows.list`, 100 per page unless `size` says less, `page` is 0-based. Rates arrive masked when the person lacks `order.price`. */
export function useRows(
  candidateId: string | undefined,
  opts: { state?: RowState; page: number; size?: number; enabled?: boolean },
): Q<{ items: StagedRowView[]; hasNext: boolean }> {
  const size = opts.size ?? ROWS_PER_PAGE;
  return useQuery({
    queryKey: ingestKeys.rows(candidateId ?? "", opts.state ?? "all", opts.page, size),
    queryFn: async () => {
      const cursor = await cursorForPage(candidateId!, opts.state, opts.page, size);
      const result = await ingestApi().rowsList({ candidateId: candidateId!, state: opts.state, cursor, limit: size });
      pageCursors.set(pageKey(candidateId!, opts.state, opts.page + 1, size), result.nextCursor ?? undefined);
      return { items: result.items, hasNext: result.nextCursor !== null };
    },
    enabled: Boolean(candidateId) && (opts.enabled ?? true),
    meta: INLINE_ERROR_META,
  });
}

/** The most rows "Needs a decision" reads from each of the two server states. Past this, decide some, and more load. */
export const NEEDS_DECISION_WINDOW = ROWS_PER_PAGE;

/**
 * The rows of one view of the rows panel: a filter and a 0-based page of `ROWS_UI_PAGE` (15) rows. `needsDecision`
 * has no server filter of its own: it reads the first page of ambiguous rows and of conflict rows, keeps those with no
 * decision, and joins them in file order. A plant with more than 100 undecided rows of one kind sees the first 100
 * of each; as they are decided, the next ones come.
 */
export function useRowsPage(
  candidateId: string | undefined,
  filter: RowFilter,
  page: number,
): { items: StagedRowView[]; hasNext: boolean; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; data: unknown } {
  const [first, second] = serverStatesFor(filter);
  const union = filter === "needsDecision";
  const a = useRows(candidateId, { state: first, page: union ? 0 : page, size: union ? NEEDS_DECISION_WINDOW : ROWS_UI_PAGE });
  const b = useRows(candidateId, { state: second, page: 0, size: NEEDS_DECISION_WINDOW, enabled: union });
  if (!union) {
    return { items: a.data?.items ?? [], hasNext: a.data?.hasNext ?? false, isLoading: a.isLoading, isError: a.isError, error: a.error, refetch: () => void a.refetch(), data: a.data };
  }
  const joined = [...(a.data?.items ?? []), ...(b.data?.items ?? [])]
    .filter((r) => r.decision === null && r.mergeState === "open")
    .sort((x, y) => x.rowIndex - y.rowIndex);
  const from = page * ROWS_UI_PAGE;
  return {
    items: joined.slice(from, from + ROWS_UI_PAGE),
    hasNext: joined.length > from + ROWS_UI_PAGE,
    isLoading: a.isLoading || b.isLoading,
    isError: a.isError || b.isError,
    error: a.error ?? b.error,
    refetch: () => {
      void a.refetch();
      void b.refetch();
    },
    data: a.data && b.data ? true : undefined,
  };
}

/** Every file the plant has added, newest first, up to `MAX_LISTED_ARTIFACTS`. The list screen reads each file's date and kind from it. */
export const MAX_LISTED_ARTIFACTS = 500;

export async function listAllArtifacts(): Promise<ArtifactSummary[]> {
  const out: ArtifactSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await ingestApi().artifactList({ cursor, limit: 50 });
    out.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && out.length < MAX_LISTED_ARTIFACTS);
  return out;
}

/** Files of the plant (`artifact.list`). Polls while any file is still being read. */
export function useArtifacts(): Q<ArtifactSummary[]> {
  return useQuery({
    queryKey: ingestKeys.artifacts(),
    queryFn: listAllArtifacts,
    refetchInterval: (query) => ((query.state.data ?? []).some((a) => a.readState === "reading") ? POLL_MS : false),
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
