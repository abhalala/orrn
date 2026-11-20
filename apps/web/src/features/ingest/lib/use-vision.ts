import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";

import { refreshIngest } from "./actions";
import { ingestApi } from "./trpc-api";
import type { ArtifactKind, CandidateDetail, StagedRowView } from "./types";
import { useRunAction } from "./use-run-action";
import { visionApi } from "./vision-api";
import { finishFile, PAGE_READS_PER_PASS, type VisionProgress } from "./vision-pump";
import { readVisualBytes, type VisualReadOutcome } from "./vision-read";
import type { VisionPageView, VisionPagesOut } from "./vision-types";

/**
 * Hooks of the vision read: the file page's pages and its "Read this file" pass, the page image of the review, and the
 * writes of both. Every query key starts with `ingest`, so `refreshIngest` refreshes them with the rest.
 */

export const visionKeys = {
  pages: (artifactId: string) => ["ingest", "artifact", artifactId, "vision"] as const,
  image: (artifactId: string, page: number) => ["ingest", "vision-image", artifactId, page] as const,
  rows: (candidateId: string) => ["ingest", "rows", candidateId, "vision-all"] as const,
};

/** A signed page link lives 10 minutes; the page asks for a new one after 8, and when the tab comes back after that. */
export const PAGE_LINK_FRESH_MS = 8 * 60 * 1000;

/** `vision.pages` of a file being read page by page. */
export function useVisionPages(artifactId: string, enabled: boolean): UseQueryResult<VisionPagesOut> {
  return useQuery({
    queryKey: visionKeys.pages(artifactId),
    queryFn: () => visionApi().pages({ artifactId }),
    enabled,
    meta: INLINE_ERROR_META,
  });
}

/** The signed link of one page image (`vision.readUrl` page), asked again before it runs out. */
export function usePageImage(artifactId: string, page: number | null): UseQueryResult<{ url: string; expiresAt: number }> {
  return useQuery({
    queryKey: visionKeys.image(artifactId, page ?? 0),
    queryFn: () => visionApi().readUrl({ artifactId, what: "page", page: page! }),
    enabled: page !== null,
    staleTime: PAGE_LINK_FRESH_MS,
    refetchInterval: PAGE_LINK_FRESH_MS,
    refetchOnWindowFocus: true,
    gcTime: 0,
    retry: false,
    meta: INLINE_ERROR_META,
  });
}

/** Most rows one table read from a page holds is 500; 10 pages of 100 leave room. */
const ROW_PAGES = 10;

/** Every staged row of a table read from a page, for the check against the page (rows the model doubted go first). */
export function useVisionRows(candidateId: string, enabled: boolean): UseQueryResult<StagedRowView[]> {
  return useQuery({
    queryKey: visionKeys.rows(candidateId),
    queryFn: async () => {
      const out: StagedRowView[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < ROW_PAGES; page += 1) {
        const res = await ingestApi().rowsList({ candidateId, cursor });
        out.push(...res.items);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      return out;
    },
    enabled,
    meta: INLINE_ERROR_META,
  });
}

export type FileReadPhase = "idle" | "running" | "done" | "error";

/**
 * "Read this file" and "Carry on reading" on the file page. With `needsBytes` the raw file comes back by a signed read
 * and its pages are rendered and sent; without, the pages already stored are read one by one. Either way the person can
 * leave: any tab carries on from what the server holds.
 */
export function useVisionFileRead(artifactId: string, kind: ArtifactKind): {
  phase: FileReadPhase;
  progress: VisionProgress | null;
  outcome: VisualReadOutcome | null;
  error: unknown;
  run: (opts: { needsBytes: boolean; pages?: readonly VisionPageView[] }) => Promise<void>;
} {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<FileReadPhase>("idle");
  const [progress, setProgress] = useState<VisionProgress | null>(null);
  const [outcome, setOutcome] = useState<VisualReadOutcome | null>(null);
  const [error, setError] = useState<unknown>(null);
  const flight = useRef(false);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const run = useCallback(
    async ({ needsBytes, pages }: { needsBytes: boolean; pages?: readonly VisionPageView[] }) => {
      if (flight.current) return;
      flight.current = true;
      ctl.current = new AbortController();
      const signal = ctl.current.signal;
      setPhase("running");
      setError(null);
      setOutcome(null);
      try {
        const api = visionApi();
        if (needsBytes) {
          setProgress({ phase: "opening" });
          const link = await api.readUrl({ artifactId, what: "raw" });
          const res = await fetch(link.url, { signal });
          if (!res.ok) throw Object.assign(new Error(`read failed (${res.status})`), { data: { code: res.status === 404 ? "NOT_FOUND" : "UNKNOWN" } });
          const file = await res.blob();
          setOutcome(await readVisualBytes({ api, artifactId, file, kind, signal, onProgress: setProgress }));
        } else {
          const due = (pages ?? []).filter((p) => p.state === "ready").map((p) => p.page);
          const total = (pages ?? []).length;
          for (const page of due) {
            await readOnePage(artifactId, page, (p) => setProgress(p), total, signal);
          }
          const after = await api.pages({ artifactId });
          if (after.settled) await finishFile(api, artifactId);
        }
        setPhase("done");
      } catch (e) {
        if ((e as { name?: string } | null)?.name === "AbortError") return;
        setError(e);
        setPhase("error");
      } finally {
        flight.current = false;
        setProgress(null);
        await refreshIngest(qc);
      }
    },
    [artifactId, kind, qc],
  );

  return { phase, progress, outcome, error, run };
}

/** One page, read again while the answer says retry (at most the server's per-page cap in one go). */
async function readOnePage(artifactId: string, page: number, onProgress: (p: VisionProgress) => void, total: number, signal?: AbortSignal): Promise<VisionPageView> {
  let view: VisionPageView | null = null;
  for (let i = 0; i < PAGE_READS_PER_PASS; i += 1) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    onProgress({ phase: "reading", page, total });
    view = await visionApi().readPage({ artifactId, page });
    if (view.next !== "retry") break;
  }
  onProgress({ phase: "page", page, total, view: view! });
  return view!;
}

/** The writes of the file page's pages: read again, skip, type, and finish. One at a time. */
export function useVisionPageActions(artifactId: string, total: number) {
  const runner = useRunAction();
  const qc = useQueryClient();
  const after = useCallback(async () => refreshIngest(qc), [qc]);
  const [lastPage, setLastPage] = useState<VisionPageView | null>(null);
  return {
    pending: runner.pending,
    busy: runner.busy,
    error: runner.error,
    lastPage,
    readAgain: (page: number) =>
      runner.run(`read:${page}`, async () => {
        setLastPage(await readOnePage(artifactId, page, () => undefined, total));
        await after();
      }),
    skip: (page: number) =>
      runner.run(`skip:${page}`, async () => {
        setLastPage(await visionApi().skipPage({ artifactId, page }));
        await after();
      }),
    type: (page: number, table: { title: string | null; headers: string[]; rows: string[][] }) =>
      runner.run(`type:${page}`, async () => {
        setLastPage(await visionApi().typePage({ artifactId, page, ...table }));
        await after();
      }),
    finish: () =>
      runner.run("finish", async () => {
        await finishFile(visionApi(), artifactId);
        await after();
      }),
  };
}

/** The writes of the review's page check: the tick and "Fix this cell". Both answer the fresh candidate. */
export function useVisionCheckActions(candidate: Pick<CandidateDetail, "id" | "serverSeq">) {
  const runner = useRunAction();
  const qc = useQueryClient();
  const settle = useCallback(
    async (next: CandidateDetail) => {
      qc.setQueryData(["ingest", "candidate", candidate.id], next);
      await refreshIngest(qc, candidate.id);
    },
    [qc, candidate.id],
  );
  return {
    pending: runner.pending,
    busy: runner.busy,
    error: runner.error,
    clearError: runner.clearError,
    check: (checked: boolean) =>
      runner.run("check", async () => settle(await visionApi().check({ candidateId: candidate.id, expectSeq: candidate.serverSeq, checked })), { candidateId: candidate.id }),
    fixCell: (rowIndex: number, col: number, text: string) =>
      runner.run("fix", async () => settle(await visionApi().fixCell({ candidateId: candidate.id, expectSeq: candidate.serverSeq, rowIndex, col, text })), { candidateId: candidate.id }),
  };
}
