import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";

import { sectionLabel } from "@/features/stock/sections";
import { StockFilterBar } from "@/features/stock/stock-filter-bar";
import { stockFilterInput, validateStockFilter, withoutFilters } from "@/features/stock/stock-filters";
import { StockTotals } from "@/features/stock/stock-totals";
import { StockViewSwitch } from "@/features/stock/stock-view-switch";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/stock/yards")({
  // The yard filter makes no sense on a view of every yard.
  validateSearch: (raw: Record<string, unknown>) => {
    const { yard: _yard, ...rest } = validateStockFilter(raw);
    return rest;
  },
  component: StockYards,
});

type YardRow = {
  locationId: string | null;
  code: string | null;
  name: string | null;
  bundles: number;
  pcs: number;
  weightG: number;
  reserved: number;
  sections: number;
  top: { dieId: string; sectionCode: string; series: string; bundles: number; weightG: number }[];
};

/**
 * `/stock/yards`: where the stock is (explorer High 14). One card per yard with its bundles, kg,
 * held bundles and its biggest sections; a yard opens the Bundles tab for that yard. Bundles with no
 * yard recorded (legacy stock) are their own card. The same filters as the other tabs apply.
 */
function StockYards() {
  const { t } = useT();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery(trpc.stock.byYard.queryOptions(stockFilterInput(search)));
  const yards = (q.data?.yards ?? []) as YardRow[];
  const unplaced = (q.data?.unplaced ?? null) as YardRow | null;

  return (
    <>
      <PageHeader
        title={t("stock.title")}
        actions={
          <Can do="stock.count">
            <Button asChild variant="secondary">
              <Link to="/stock/count">
                <ClipboardCheck aria-hidden="true" strokeWidth={2} />
                {t("stock.count.open")}
              </Link>
            </Button>
          </Can>
        }
      />
      <StockViewSwitch current="yards" />
      <StockFilterBar
        filter={search}
        showYard={false}
        onChange={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }) })}
        onClear={() => void navigate({ search: (prev) => withoutFilters(prev) })}
      />
      <StockTotals totals={q.data?.totals} loading={q.isPending} />
      {q.isError && !q.data ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("stock.loadError")}
            action={
              <Button variant="secondary" onClick={() => void q.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : q.isPending ? (
        <div aria-busy="true" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[148px] rounded-card" />
          ))}
        </div>
      ) : yards.length === 0 && !unplaced ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("stock.yardsEmpty")} />
        </div>
      ) : (
        <ul aria-label={t("stock.yards")} data-testid="yard-cards" className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {yards.map((y) => (
            <li key={y.locationId ?? "none"}>
              <YardCard y={y} filter={search} />
            </li>
          ))}
          {unplaced ? (
            <li>
              <YardCard y={unplaced} filter={search} />
            </li>
          ) : null}
        </ul>
      )}
    </>
  );
}

function YardCard({ y, filter }: { y: YardRow; filter: Record<string, unknown> }) {
  const { t } = useT();
  const empty = y.bundles === 0;
  return (
    <div
      data-yard={y.code ?? "none"}
      className="flex h-full min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h2 className="m-0 font-mono text-[22px] font-semibold tracking-[-0.01em]">{y.code ?? t("stock.noYard")}</h2>
        {y.name && y.name !== y.code ? <span className="min-w-0 truncate text-[13px] text-muted-foreground">{y.name}</span> : null}
      </div>
      <p data-no-truncate="" className="m-0 font-display text-[28px] leading-none font-extrabold tracking-[-0.03em] tabular-nums" data-testid="yard-kg">
        {formatKgTotal(gToKg(y.weightG))} <span className="text-[15px] font-semibold text-muted-foreground">{t("units.kg")}</span>
      </p>
      <p className="m-0 text-[14px] text-muted-foreground tabular-nums">
        {t("stock.yardLine", { bundles: y.bundles.toLocaleString("en-IN"), sections: y.sections })}
        {y.reserved > 0 ? ` · ${t("stock.heldChip", { count: y.reserved })}` : ""}
      </p>
      {y.top.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]" aria-label={t("stock.yardTop")}>
          {y.top.map((s) => (
            <li key={s.dieId} className="flex min-w-0 items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{sectionLabel({ series: s.series, sectionCode: s.sectionCode })}</span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{formatKgTotal(gToKg(s.weightG))}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {empty ? (
          <Chip tone="neutral">{t("stock.yardEmpty")}</Chip>
        ) : y.locationId ? (
          <>
            <Button asChild variant="secondary" size="sm">
              <Link to="/stock/bundles" search={{ ...filter, yard: y.locationId } as never}>
                {t("stock.bundles")}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/stock/lengths" search={{ ...filter, yard: y.locationId } as never}>
                {t("stock.lengths")}
              </Link>
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
