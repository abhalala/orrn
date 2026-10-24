import { formatKgTotal, formatLength, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { kg12Text, positionKey, positionTone } from "@/features/pack/line-preview";
import { sectionLabel } from "@/features/stock/sections";
import { StockFilterBar } from "@/features/stock/stock-filter-bar";
import { stockFilterInput, validateStockFilter, withoutFilters, type StockFilter } from "@/features/stock/stock-filters";
import { StockTotals } from "@/features/stock/stock-totals";
import { StockViewSwitch } from "@/features/stock/stock-view-switch";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc } from "@/shared/utils/trpc";

type LengthsSearch = StockFilter & { page?: number };

const PAGE = 100;

export const Route = createFileRoute("/_tenant/stock/lengths")({
  validateSearch: (raw: Record<string, unknown>): LengthsSearch => {
    const n = typeof raw.page === "string" ? Number(raw.page) : raw.page;
    return { ...validateStockFilter(raw), ...(typeof n === "number" && Number.isInteger(n) && n >= 2 ? { page: n } : {}) };
  },
  component: StockLengths,
});

/**
 * `/stock/lengths`: stock by section and cut length (FP-PK-08). In-stock bundles (held ones are still
 * in the yard) grouped by section and length, kg/12 ft weighted by pieces with the server's band
 * verdict, and what is held on a dispatch. Filters live in the URL; totals come from the server.
 */
function StockLengths() {
  const { t } = useT();
  const lu = useLengthUnit();
  const when = useCompanyWhen();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { page, ...filter } = search;
  const offset = ((page ?? 1) - 1) * PAGE;
  const q = useQuery({
    ...trpc.stock.byDieLength.queryOptions({ ...stockFilterInput(filter), limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const items = q.data?.items ?? [];
  type Row = (typeof items)[number];

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "section", header: t("stock.columns.section"), cell: (r) => <span className="font-semibold">{sectionLabel({ series: r.series, sectionCode: r.sectionCode })}</span> },
    { key: "length", header: t("stock.columns.cutLength"), align: "end", cell: (r) => <span className="font-mono whitespace-nowrap">{formatLength(r.lengthMm, lu.unit)}</span> },
    { key: "bundles", header: t("pack.columns.bundles"), align: "end", cell: (r) => <span className="font-mono">{r.bundles}</span> },
    { key: "pcs", header: t("stock.columns.pieces"), align: "end", cell: (r) => <span className="font-mono">{r.pcs.toLocaleString("en-IN")}</span> },
    { key: "kg", header: t("stock.columns.weight"), align: "end", cell: (r) => <span className="font-mono">{formatKgTotal(gToKg(r.weightG))}</span> },
    {
      key: "kg12",
      header: t("stock.columns.kgPer12ft"),
      align: "end",
      cell: (r) => {
        const key = positionKey(r.band.position);
        return (
          <span className="inline-flex items-center justify-end gap-2">
            <span className="font-mono">{kg12Text(r.avgKgPer12ftMilli) ?? "-"}</span>
            {key ? <Chip tone={positionTone(r.band.position)} data-verdict={r.band.position}>{t(key)}</Chip> : null}
          </span>
        );
      },
    },
    {
      key: "held",
      header: t("stock.columns.held"),
      hideOnPhone: true,
      align: "end",
      cell: (r) => (r.reserved > 0 ? <Chip tone="blue">{t("stock.heldChip", { count: r.reserved })}</Chip> : <span className="text-muted-foreground">-</span>),
    },
    { key: "oldest", header: t("stock.columns.oldest"), hideOnPhone: true, cell: (r) => <span className="whitespace-nowrap">{when(r.oldestAt)}</span> },
  ];

  return (
    <>
      <PageHeader title={t("stock.title")} />
      <StockViewSwitch current="lengths" />
      <StockFilterBar
        filter={filter}
        onChange={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) })}
        onClear={() => void navigate({ search: (prev) => withoutFilters({ ...prev, page: undefined }) })}
      />
      <StockTotals totals={q.data?.totals} kinds={q.data?.kindTotals} loading={q.isPending} />
      <ResponsiveList
        rows={items}
        columns={columns}
        rowKey={(r) => `${r.dieId}:${r.lengthMm}`}
        rowHref={(r) => `/stock/${r.dieId}`}
        label={t("stock.lengthsLabel")}
        loading={q.isFetching && q.isPlaceholderData}
        page={{ offset, limit: PAGE, onChange: (o) => void navigate({ search: (prev) => ({ ...prev, page: o / PAGE + 1 > 1 ? o / PAGE + 1 : undefined }) }) }}
        empty={
          q.isError ? (
            <EmptyState
              title={t("stock.loadError")}
              action={
                <Button variant="secondary" onClick={() => void q.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("stock.lengthsEmpty")} />
          )
        }
      />
    </>
  );
}
