import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useMemo, useState } from "react";

import { SectionGrid, SectionGridSkeleton } from "@/features/stock/section-blocks";
import {
  filterSections,
  mergeSections,
  sectionLabel,
  sectionTotals,
  sortSections,
  type SectionSort,
} from "@/features/stock/sections";
import { StockViewSwitch } from "@/features/stock/stock-view-switch";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

// The chart kit loads only for analytics roles, never in the entry chunk.
const StockCharts = lazy(() => import("@/features/stock/stock-charts"));

const SORT_KEY = "orrn.stock.sort";

function readSort(): SectionSort {
  try {
    return localStorage.getItem(SORT_KEY) === "az" ? "az" : "kg";
  } catch {
    return "kg";
  }
}

export const Route = createFileRoute("/_tenant/stock/")({
  loader: ({ context }) => {
    // Start both summaries while the route chunk loads; the screen shows its skeleton meanwhile.
    void context.queryClient.prefetchQuery(trpc.bundle.stockSummary.queryOptions({ status: "available" }));
    void context.queryClient.prefetchQuery(trpc.bundle.stockSummary.queryOptions({ status: "reserved" }));
  },
  component: StockSections,
});

/**
 * `/stock`, Sections: one green block per section with bundles in stock
 * (blue when all of them are held), from `bundle.stockSummary` for available
 * and reserved stock merged per die. Search and sort run on the loaded
 * sections. Owners and managers also see stock age and top sections, above
 * the sections on wide screens and after them on phones.
 */
function StockSections() {
  const { t } = useT();
  const available = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "available" }));
  const reserved = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "reserved" }));
  const [query, setQuery] = useState("");
  const [sort, setSortState] = useState<SectionSort>(readSort);

  const setSort = (next: SectionSort) => {
    setSortState(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      // Private mode: the choice holds for this visit.
    }
  };

  const sections = useMemo(
    () => (available.data && reserved.data ? mergeSections(available.data.items, reserved.data.items) : []),
    [available.data, reserved.data],
  );
  const shown = useMemo(() => sortSections(filterSections(sections, query), sort), [sections, query, sort]);
  const totals = useMemo(() => sectionTotals(sections), [sections]);
  const labels = useMemo(() => new Map(sections.map((s) => [s.dieId, sectionLabel(s)])), [sections]);
  const labelFor = useCallback((dieId: string) => labels.get(dieId), [labels]);

  const loading = available.isPending || reserved.isPending;
  const failed = available.isError || reserved.isError;
  const retry = () => {
    void available.refetch();
    void reserved.refetch();
  };
  const hasStock = sections.length > 0;
  // Side by side above the sections from 1024px; on phones and iPad portrait the sections come first
  // (in the DOM too, so reading and focus order match what is on screen).
  const wide = useMediaQuery(breakpoints.desktop);
  const charts = (
    <Can do="analytics.view">
      <Suspense fallback={<ChartsFallback />}>
        <StockCharts labelFor={labelFor} />
      </Suspense>
    </Can>
  );

  return (
    <>
      <PageHeader title={t("stock.title")} />
      <div className="-mt-2 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-2" data-testid="stock-totals">
        {loading ? (
          <Skeleton className="h-5 w-56" />
        ) : hasStock ? (
          <>
            <p className="m-0 text-[15px] leading-6 text-muted-foreground tabular-nums">
              {t("stock.totals", {
                bundles: totals.available.bundles.toLocaleString("en-IN"),
                kg: formatKgTotal(gToKg(totals.available.weightG)),
              })}
            </p>
            {totals.held.bundles > 0 ? (
              <Chip tone="blue">{t("stock.heldChip", { count: totals.held.bundles.toLocaleString("en-IN") })}</Chip>
            ) : null}
          </>
        ) : null}
      </div>

      <StockViewSwitch current="sections" />

      {hasStock && wide ? charts : null}

      <section aria-labelledby="stock-sections-heading" className="flex min-w-0 flex-col gap-4">
        <h2 id="stock-sections-heading" className="sr-only">
          {t("stock.sections")}
        </h2>

        {failed ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("stock.loadError")}
              action={
                <Button variant="secondary" onClick={retry}>
                  {t("common.retry")}
                </Button>
              }
            />
          </div>
        ) : loading ? (
          <div aria-busy="true" className="flex flex-col gap-4">
            <span className="sr-only">{t("common.loading")}</span>
            <Skeleton className="h-[72px] w-full rounded-card" />
            <SectionGridSkeleton />
          </div>
        ) : !hasStock ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("stock.empty")}
              action={
                <Can do="bundle.pack">
                  <Button asChild>
                    <Link to="/pack/new">{t("stock.emptyAction")}</Link>
                  </Button>
                </Can>
              }
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <Field label={t("stock.searchSections")} className="md:max-w-sm md:flex-1">
                <TextInput
                  type="search"
                  value={query}
                  onChangeText={setQuery}
                  autoComplete="off"
                  enterKeyHint="search"
                  data-testid="section-search"
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                {/* Visible label; the group carries the same name for screen readers. */}
                <span aria-hidden="true" className="text-[14px] font-semibold leading-5 text-foreground">
                  {t("common.sort")}
                </span>
                <SegmentedControl
                  label={t("common.sort")}
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "kg", label: t("common.sortMostKg") },
                    { value: "az", label: t("common.sortAZ") },
                  ]}
                />
              </div>
            </div>

            <p aria-live="polite" className="sr-only">
              {query.trim() ? t("stock.sectionsFound", { count: shown.length }) : ""}
            </p>

            {shown.length > 0 ? (
              <SectionGrid sections={shown} label={t("stock.sections")} />
            ) : (
              <div className="rounded-card border border-border bg-card">
                <EmptyState
                  title={t("common.noResults", { query: query.trim() })}
                  action={
                    <Button variant="secondary" onClick={() => setQuery("")}>
                      {t("stock.clearSearch")}
                    </Button>
                  }
                />
              </div>
            )}
          </>
        )}
      </section>

      {hasStock && !wide ? charts : null}
    </>
  );
}

/** Two chart-shaped placeholders while the chart kit chunk loads (no kit code here). */
function ChartsFallback() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Skeleton className="h-[318px] w-full rounded-card" />
      <Skeleton className="h-[318px] w-full rounded-card" />
    </div>
  );
}
