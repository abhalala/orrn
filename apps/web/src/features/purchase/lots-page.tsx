/**
 * `/purchase`: scrap lots, newest first. The loud element is the KPI row
 * (lots at the kanta, scrap in stock); the list is quiet; owners and managers
 * (`analytics.view`) get the rate and vendor charts below, loaded lazily.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { HowToButton } from "@orrn/ui/components/how-to-button";
import { motionClass, riseDelay } from "@orrn/ui/components/motion";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";

import { Can } from "@/shared/components/can";
import { RouterLink } from "@/shared/components/router-link";
import { trpc } from "@/shared/utils/trpc";

import { isForbidden } from "./errors";
import { bookDayText, kgText, slashBreaks } from "./format";
import { readKantaG } from "./kanta";
import { DiffText, LotStatusChip, useCompanyToday, useToleranceBp } from "./lot-ui";
import { lotListChip, type LotFlag, type LotStatus } from "./lot-view";
import { showsQueryError } from "./query-state";

const PurchaseCharts = lazy(() => import("./purchase-charts"));

export const LOT_FILTERS = ["all", "booking", "unload", "ok"] as const;
export type LotFilter = (typeof LOT_FILTERS)[number];

export function isLotFilter(v: unknown): v is LotFilter {
  return typeof v === "string" && (LOT_FILTERS as readonly string[]).includes(v);
}

const PAGE = 25;

type LotRow = {
  id: string;
  number: string;
  lotDate: string;
  vendorName: string;
  itemName: string;
  gradeCode: string;
  partyKgG: number;
  fcKgG: number | null;
  status: LotStatus;
};

export function LotsPage({ filter, onFilter }: { filter: LotFilter; onFilter(f: LotFilter): void }) {
  const { t, locale } = useT();
  const tolBp = useToleranceBp();
  const today = useCompanyToday();
  const [offset, setOffset] = useState(0);
  const status = filter === "all" ? undefined : filter;

  const lots = useQuery({
    ...trpc.purchase.lots.list.queryOptions({ status, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const booking = useQuery(trpc.purchase.lots.list.queryOptions({ status: "booking", limit: 1, offset: 0 }));
  const unload = useQuery(trpc.purchase.lots.list.queryOptions({ status: "unload", limit: 1, offset: 0 }));
  const stock = useQuery(trpc.purchase.scrapStock.queryOptions());

  const atKanta = booking.data && unload.data ? booking.data.total + unload.data.total : null;
  const atKantaFailed = showsQueryError(booking) || showsQueryError(unload);

  // The lots' flags (short without a note, note waiting) come from the register over this page's
  // book dates: `lots.list` has no flag yet (PL-6 follow-up). Absent = unknown = no chip.
  const rows = (lots.data?.items ?? []) as LotRow[];
  const span = useMemo(() => {
    if (rows.length === 0) return null;
    const dates = rows.map((r) => r.lotDate).sort();
    return { from: dates[0]!, to: dates[dates.length - 1]! };
  }, [rows]);
  const register = useQuery({
    ...trpc.purchase.register.queryOptions(span ?? { from: today, to: today }),
    enabled: span !== null,
    select: (d) => new Map<string, LotFlag>(d.lots.map((l) => [l.id, l.flag])),
  });
  const flags = register.data;

  const columns: ResponsiveListColumn<LotRow>[] = [
    {
      key: "lot",
      header: t("purchase.list.lot"),
      cell: (l) => (
        <span className="flex flex-col">
          <span className="font-mono whitespace-nowrap">{l.number}</span>
          <span className="text-[13px] font-normal whitespace-nowrap text-muted-foreground">{bookDayText(l.lotDate, locale, today)}</span>
        </span>
      ),
    },
    { key: "vendor", header: t("purchase.list.vendor"), cell: (l) => l.vendorName },
    {
      key: "material",
      header: t("purchase.list.material"),
      cell: (l) => slashBreaks(t("purchase.material", { item: l.itemName, grade: l.gradeCode })),
    },
    {
      key: "party",
      header: t("purchase.list.party"),
      align: "end",
      // Phones show the verdict (difference) and keep both kantas for the lot page: a card stays one glance.
      hideOnPhone: true,
      cell: (l) => <span className="font-mono">{kgText(l.partyKgG)}</span>,
    },
    {
      key: "ours",
      header: t("purchase.list.ours"),
      align: "end",
      hideOnPhone: true,
      cell: (l) => <span className="font-mono">{l.fcKgG === null ? "-" : kgText(l.fcKgG)}</span>,
    },
    {
      key: "diff",
      header: t("purchase.list.difference"),
      // Quiet words: a settled lot is not an alarm. What needs action is the chip in Status.
      cell: (l) =>
        l.status === "cancelled" ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <DiffText reading={readKantaG(l.partyKgG, l.fcKgG, tolBp)} toleranceBp={tolBp} quiet className="text-[14px]" />
        ),
    },
    {
      key: "status",
      header: t("purchase.list.status"),
      cell: (l) => {
        const chip = lotListChip(l.status, flags?.get(l.id));
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <LotStatusChip status={l.status} />
            {/* The flag is what needs doing: always in full (touch users can't hover for a title). */}
            {chip === "shortWithoutNote" ? (
              <Chip tone="red" truncate={false}>
                {t("purchase.flag.shortWithoutNote")}
              </Chip>
            ) : chip === "notePending" ? (
              <Chip tone="amber" truncate={false}>
                {t("purchase.flag.notePending")}
              </Chip>
            ) : null}
          </span>
        );
      },
    },
  ];

  const filtered = filter !== "all";

  const header = (
    <PageHeader
      title={t("purchase.title")}
      subtitle={t("purchase.subtitle")}
      actions={
        <>
          <HowToButton slug="weigh-scrap-lot" />
          <Can do="purchase.receipt">
            <Button asChild size="lg">
              <RouterLink to="/purchase/new">
                <Plus aria-hidden="true" strokeWidth={2} />
                {t("purchase.newLot")}
              </RouterLink>
            </Button>
          </Can>
        </>
      }
    />
  );

  // A role that can't read purchases (a link passed on): say so once, no skeletons that never fill.
  if (isForbidden(lots.error)) {
    return (
      <>
        {header}
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState title={t("errors.forbidden")} />
        </div>
      </>
    );
  }

  const kpiError = (onRetry: () => void): ReactNode => (
    <div role="alert" className="flex min-h-[168px] flex-col items-start justify-center gap-3 rounded-block border border-border bg-card p-5">
      <p className="m-0 text-[15px] font-medium">{t("purchase.kpi.error")}</p>
      <Button variant="secondary" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );

  return (
    <>
      {header}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {atKantaFailed ? (
          kpiError(() => void Promise.all([booking.refetch(), unload.refetch()]))
        ) : atKanta === null ? (
          <Skeleton className="h-[168px] rounded-block" />
        ) : (
          <StatusBlock
            className={motionClass.rise}
            style={riseDelay(0)}
            tone="amber"
            title={t("purchase.kpi.atKanta")}
            meta={t("purchase.kpi.atKantaMeta")}
            value={atKanta}
            unit={t("purchase.kpi.lots", { count: atKanta })}
          />
        )}
        {showsQueryError(stock) ? (
          kpiError(() => void stock.refetch())
        ) : stock.data ? (
          <StatusBlock
            className={motionClass.rise}
            style={riseDelay(1)}
            tone="green"
            title={t("purchase.kpi.inStock")}
            meta={t("purchase.kpi.inStockMeta")}
            value={stock.data.totalG / 1000}
            format={(kg) => kgText(Math.round(kg) * 1000)}
            unit="kg"
          />
        ) : (
          <Skeleton className="h-[168px] rounded-block" />
        )}
      </div>

      <div className="flex flex-col gap-3">
        <SegmentedControl
          label={t("purchase.filter.label")}
          value={filter}
          onChange={(f) => {
            setOffset(0);
            onFilter(f);
          }}
          options={LOT_FILTERS.map((f) => ({ value: f, label: t(`purchase.filter.${f}`) }))}
        />
        {showsQueryError(lots) ? (
          <div role="alert" className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("purchase.list.error")}
              action={
                <Button variant="secondary" onClick={() => lots.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          </div>
        ) : (
          <ResponsiveList
            label={t("purchase.list.label")}
            rows={rows}
            columns={columns}
            rowKey={(l) => l.id}
            rowHref={(l) => `/purchase/${l.id}`}
            total={lots.data?.total}
            page={{ offset, limit: PAGE, onChange: setOffset }}
            loading={lots.isLoading || (lots.isFetching && lots.isPlaceholderData)}
            empty={
              filtered ? (
                <EmptyState
                  title={t("purchase.list.emptyFilteredTitle")}
                  body={t("purchase.list.emptyFilteredBody")}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setOffset(0);
                        onFilter("all");
                      }}
                    >
                      {t("purchase.list.showAll")}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title={t("purchase.list.emptyTitle")}
                  body={t("purchase.list.emptyBody")}
                  action={
                    <Can do="purchase.receipt">
                      <Button asChild>
                        <RouterLink to="/purchase/new">{t("purchase.newLot")}</RouterLink>
                      </Button>
                    </Can>
                  }
                />
              )
            }
          />
        )}
      </div>

      <Can do="analytics.view">
        <Suspense
          fallback={
            <div aria-busy="true" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Skeleton className="h-[340px] rounded-card" />
              <Skeleton className="h-[340px] rounded-card" />
            </div>
          }
        >
          <PurchaseCharts />
        </Suspense>
      </Can>
    </>
  );
}
