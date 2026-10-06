import { DISPATCH_STATUSES, dispatchTone, formatKgTotal, type DispatchStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { formatShipDate } from "@/features/dispatch/format";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

/** Monthly volume chart, only fetched for `analytics.view` (chart kit stays out of floor roles' downloads). */
const DispatchVolumeChart = lazy(() => import("@/features/dispatch/volume-chart"));

const PAGE = 25;

type ListSearch = { status?: DispatchStatus; q?: string; page?: number };

export const Route = createFileRoute("/_tenant/dispatch/")({
  validateSearch: (raw: Record<string, unknown>): ListSearch => {
    const status = (DISPATCH_STATUSES as readonly string[]).includes(String(raw.status))
      ? (raw.status as DispatchStatus)
      : undefined;
    const q = typeof raw.q === "string" && raw.q.trim() ? raw.q : undefined;
    const page = Number(raw.page);
    return { status, q, page: Number.isInteger(page) && page > 1 ? page : undefined };
  },
  component: DispatchListPage,
});

type Row = {
  id: string;
  code: string;
  status: DispatchStatus;
  shipDate: string | Date | null;
  customerName: string;
  itemCount: number;
  totalWeightG: number;
};

function DispatchListPage() {
  const { t, locale } = useT();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const status = search.status ?? "draft";
  const offset = ((search.page ?? 1) - 1) * PAGE;
  const [text, setText] = useState(search.q ?? "");
  // The last search this box put in the URL: any other change of `q` came from Back,
  // Forward or a link, and the box follows it instead of writing its old text back.
  const sent = useRef(search.q);
  useEffect(() => {
    if (search.q === sent.current) return;
    sent.current = search.q;
    setText(search.q ?? "");
  }, [search.q]);

  // Typing settles for 250 ms before it reaches the URL (and the server).
  useEffect(() => {
    const next = text.trim() || undefined;
    if (next === search.q) return;
    const timer = setTimeout(() => {
      sent.current = next;
      void navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }), replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [text, search.q, navigate]);

  const list = useQuery({
    ...trpc.dispatch.listDispatches.queryOptions({ status, search: search.q, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });

  const statusWord = (s: DispatchStatus) => t(`status.dispatch.${s}`);
  const columns: ResponsiveListColumn<Row>[] = [
    {
      key: "code",
      header: t("dispatch.columns.code"),
      cell: (r) => <span className="font-mono whitespace-nowrap">{r.code}</span>,
    },
    { key: "customer", header: t("dispatch.columns.customer"), cell: (r) => r.customerName },
    {
      key: "ship",
      header: t("dispatch.columns.shipDate"),
      cell: (r) => formatShipDate(r.shipDate, { locale }) ?? <span className="text-muted-foreground">-</span>,
    },
    {
      key: "bundles",
      header: t("dispatch.columns.bundles"),
      align: "end",
      cell: (r) => <span className="font-mono">{Number(r.itemCount).toLocaleString("en-IN")}</span>,
    },
    {
      key: "kg",
      header: t("dispatch.columns.kg"),
      align: "end",
      cell: (r) => (
        <span data-no-truncate="" className="font-mono">
          {formatKgTotal(Number(r.totalWeightG) / 1000)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("dispatch.columns.status"),
      cell: (r) => <Chip tone={dispatchTone(r.status)}>{statusWord(r.status)}</Chip>,
    },
  ];

  const showBuilding = (
    <Button variant="secondary" onClick={() => void navigate({ search: { status: undefined } })}>
      {t("dispatch.showBuilding")}
    </Button>
  );
  const empty = search.q ? (
    <EmptyState title={t("dispatch.emptySearch", { query: search.q })} />
  ) : status === "draft" ? (
    <EmptyState
      title={t("dispatch.emptyBuilding")}
      action={
        <Can do="dispatch.create">
          <Button asChild>
            <Link to="/dispatch/new">{t("dispatch.newDispatch")}</Link>
          </Button>
        </Can>
      }
    />
  ) : (
    <EmptyState
      title={
        status === "reserved"
          ? t("dispatch.emptyHeld")
          : status === "completed"
            ? t("dispatch.emptyDispatched")
            : t("dispatch.emptyCancelled")
      }
      action={showBuilding}
    />
  );

  return (
    <>
      <PageHeader
        title={t("dispatch.title")}
        actions={
          <Can do="dispatch.create">
            <Button asChild className="max-md:h-14 max-md:w-full max-md:text-[17px]">
              <Link to="/dispatch/new">
                <Plus aria-hidden="true" strokeWidth={2} />
                {t("dispatch.newDispatch")}
              </Link>
            </Button>
          </Can>
        }
      />

      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedControl
          label={t("dispatch.show")}
          value={status}
          onChange={(next) => void navigate({ search: (prev) => ({ ...prev, status: next === "draft" ? undefined : next, page: undefined }) })}
          options={DISPATCH_STATUSES.map((s) => ({ value: s, label: statusWord(s) }))}
        />
        <div className="relative min-w-0 lg:w-[320px]">
          <Search
            aria-hidden="true"
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={text}
            onChangeText={setText}
            aria-label={t("dispatch.search")}
            placeholder={t("dispatch.searchHint")}
            className="pl-10"
          />
        </div>
      </div>

      {list.isError && !list.data ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("dispatch.loadError")}
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : (
        <ResponsiveList
          label={t("dispatch.listLabel")}
          rows={(list.data?.items ?? []) as Row[]}
          rowKey={(r) => r.id}
          rowHref={(r) => `/dispatch/${r.id}`}
          columns={columns}
          loading={list.isFetching}
          total={list.data?.total}
          page={{
            offset,
            limit: PAGE,
            onChange: (next) =>
              void navigate({ search: (prev) => ({ ...prev, page: next > 0 ? Math.floor(next / PAGE) + 1 : undefined }) }),
          }}
          empty={empty}
        />
      )}

      <Can do="analytics.view">
        <Suspense fallback={<Skeleton className="h-[330px] w-full rounded-card" />}>
          <DispatchVolumeChart />
        </Suspense>
      </Can>
    </>
  );
}
