import { useT } from "@orrn/i18n";
import type { UseQueryResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";

export type PageData<T> = { items: T[]; total: number };

export type PagedListProps<T> = {
  pageSize: number;
  /** One page of the list. Called as a hook, once per page on screen. */
  usePage: (offset: number) => UseQueryResult<PageData<T>, unknown>;
  renderRow: (row: T, index: number) => ReactNode;
  /** Shown when the first page has no rows. */
  empty: ReactNode;
};

/**
 * A list that grows by "Show more". The server pages by offset and caps a page
 * at 100 rows, so each page is its own query: only the pages on screen are
 * fetched, and a pull to refresh or a retry touches one page. Key it by the
 * search term so a new search starts again at page one.
 */
export function PagedList<T>({ pageSize, usePage, renderRow, empty }: PagedListProps<T>) {
  const [pages, setPages] = useState(1);
  return (
    <View className="gap-2">
      {Array.from({ length: pages }, (_, i) => (
        <Page
          key={i}
          offset={i * pageSize}
          pageSize={pageSize}
          usePage={usePage}
          renderRow={renderRow}
          empty={empty}
          isLast={i === pages - 1}
          onMore={() => setPages((n) => n + 1)}
        />
      ))}
    </View>
  );
}

function Page<T>({
  offset,
  pageSize,
  usePage,
  renderRow,
  empty,
  isLast,
  onMore,
}: PagedListProps<T> & { offset: number; isLast: boolean; onMore: () => void }) {
  const { t } = useT();
  const query = usePage(offset);

  if (query.data === undefined) {
    if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
    return <LoadingBlock />;
  }
  const { items, total } = query.data;
  if (offset === 0 && items.length === 0) return <>{empty}</>;
  return (
    <>
      {items.map((row, i) => renderRow(row, offset + i))}
      {isLast && offset + pageSize < total ? <Button variant="secondary" label={t("common.showMore")} onPress={onMore} /> : null}
    </>
  );
}
