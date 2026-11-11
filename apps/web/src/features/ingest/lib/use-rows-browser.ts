import { useCallback, useState } from "react";

import { useRowsPage } from "./queries";
import { defaultRowFilter, effectiveFilter, rowFilters, rowsShowingWords, type RowFilter, type RowFilterOption } from "./rows-model";
import type { Words } from "./model";
import type { CandidateCounts } from "./types";

/**
 * The rows panel's place: the filter and the page, kept while the person decides rows (M13). Mount it under a
 * component keyed by `candidate.id` only (not by `serverSeq`), so a decision never resets the filter or the page.
 * "Needs a decision" is selected at first when it has rows, and the view falls back to "All" when its last row is decided.
 */
export function useRowsBrowser(candidateId: string, counts: CandidateCounts) {
  const [chosen, setChosen] = useState<RowFilter>(() => defaultRowFilter(counts));
  const [page, setPage] = useState(0);
  const filter = effectiveFilter(chosen, counts);
  const options = rowFilters(counts);
  const current: RowFilterOption = options.find((o) => o.id === filter) ?? options[options.length - 1]!;
  const rows = useRowsPage(candidateId, filter, page);

  const setFilter = useCallback((next: RowFilter) => {
    setChosen(next);
    setPage(0);
  }, []);
  const nextPage = useCallback(() => setPage((n) => n + 1), []);
  const previousPage = useCallback(() => setPage((n) => Math.max(0, n - 1)), []);

  const showing: Words = rowsShowingWords(current, current.count, page);
  /** The pager is hidden when there is one page. */
  const pager = page > 0 || rows.hasNext;
  return { filter, options, current, page, setFilter, nextPage, previousPage, rows, showing, pager, pageWords: { key: "ingest.rows.page", vars: { n: page + 1 } } as Words };
}
