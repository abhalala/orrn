import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";
import { StoreLoadError } from "@/features/store/store-ui";

import { rupees } from "./money";
import { PO_STATUSES, poTone, type PoStatus } from "./po-model";
import type { PoRow } from "./use-buy";

const LIMIT = 50;

type Filter = "all" | PoStatus;

/** The Orders tab of Buying: purchase orders, newest first, one status at a time. Rows open the order. */
export function OrdersTab() {
  const { t } = useT();
  const fmt = useFmt();
  const [filter, setFilter] = useState<Filter>("all");
  // The filter is part of the query key, so changing it starts again from the first page.
  const query = useInfiniteQuery({
    ...trpc.store.po.list.infiniteQueryOptions(
      { ...(filter === "all" ? {} : { status: filter }), limit: LIMIT },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
    meta: INLINE_ERROR_META,
  });

  if (showsQueryError(query)) return <StoreLoadError onRetry={() => void query.refetch()} />;

  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const columns: ResponsiveListColumn<PoRow>[] = [
    { key: "number", header: t("store2.po.list.number"), cell: (r) => <span className="font-mono whitespace-nowrap">{r.number}</span> },
    { key: "vendor", header: t("store2.po.list.vendor"), cell: (r) => r.vendorName },
    {
      key: "delivery",
      header: t("store2.po.list.delivery"),
      hideOnPhone: true,
      cell: (r) => (r.deliveryDate ? bookDateText(fmt, r.deliveryDate) : t("store2.po.list.noDate")),
    },
    { key: "items", header: t("store2.po.list.items"), align: "end", hideOnPhone: true, cell: (r) => r.lines },
    { key: "amount", header: t("store2.po.list.amount"), align: "end", cell: (r) => rupees(r.amountPaise) },
    {
      key: "status",
      header: t("store2.po.list.status"),
      phoneWide: true,
      cell: (r) => (
        <Chip tone={poTone(r.status)} truncate={false}>
          {t(`store2.status.po.${r.status as PoStatus}`)}
        </Chip>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t("store2.po.list.filter")} className="flex flex-wrap gap-2">
          {(["all", ...PO_STATUSES] as const).map((id) => (
            <Button
              key={id}
              variant={filter === id ? "primary" : "secondary"}
              size="sm"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {id === "all" ? t("store2.po.list.all") : t(`store2.status.po.${id}`)}
            </Button>
          ))}
        </div>
        <Can do="po.manage">
          <Button asChild>
            <Link to="/store/po/new">
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("store2.po.list.new")}
            </Link>
          </Button>
        </Can>
      </div>
      <ResponsiveList<PoRow>
        label={t("store2.po.list.label")}
        rows={rows}
        columns={columns}
        loading={query.isLoading}
        rowKey={(r) => r.id}
        rowHref={(r) => `/store/po/${encodeURIComponent(r.id)}`}
        empty={
          filter === "all" ? (
            <EmptyState
              title={t("store2.po.list.empty")}
              body={t("store2.po.list.emptyBody")}
              action={
                <Can do="po.manage">
                  <Button asChild>
                    <Link to="/store/po/new">{t("store2.po.list.new")}</Link>
                  </Button>
                </Can>
              }
            />
          ) : (
            <EmptyState title={t("store2.po.list.emptyFiltered")} />
          )
        }
      />
      {query.hasNextPage ? (
        <div>
          <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t("common.showMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
