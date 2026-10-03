import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { BundleList } from "@/features/stock/bundle-list";
import { PAGE_SIZE, offsetOf, validateSectionSearch } from "@/features/stock/bundle-search";
import { formatKgBand } from "@/features/stock/format";
import { mergeSections, sectionLabel } from "@/features/stock/sections";
import { StatusFilter, type StatusFilterValue } from "@/features/stock/status-filter";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

const FILTERS: readonly StatusFilterValue[] = ["all", "available", "reserved", "dispatched", "void"];

export const Route = createFileRoute("/_tenant/stock/$dieId")({
  validateSearch: validateSectionSearch,
  component: SectionPage,
});

/**
 * `/stock/$dieId`: one section's bundles. In stock first (the default
 * filter), then Held, Dispatched, Void or All. The hero block is the
 * section's stock; the die's kg/12ft band sits under the title.
 */
function SectionPage() {
  const { t } = useT();
  const { dieId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const status: StatusFilterValue = search.status ?? "available";

  const dieQuery = useQuery({ ...trpc.die.get.queryOptions({ id: dieId }), retry: false });
  const available = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "available" }));
  const reserved = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "reserved" }));
  const bundles = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
      dieId,
      status: status === "all" ? undefined : status,
      limit: PAGE_SIZE,
      offset: offsetOf(search.page),
    }),
    placeholderData: keepPreviousData,
  });

  if (dieQuery.isError && isNotFound(dieQuery.error)) {
    return (
      <EmptyState
        title={t("errors.notFoundInCompany")}
        action={
          <Button asChild variant="secondary">
            <Link to="/stock">{t("stock.title")}</Link>
          </Button>
        }
      />
    );
  }

  const die = dieQuery.data;
  const label = die ? sectionLabel(die) : "";
  const band = die ? formatKgBand(die.weightMinG, die.weightMaxG) : null;
  const stock =
    available.data && reserved.data
      ? mergeSections(available.data.items, reserved.data.items).find((s) => s.dieId === dieId)
      : undefined;
  const inStock = stock?.available ?? { bundles: 0, weightG: 0 };
  const held = stock?.held.bundles ?? 0;
  const summaryLoading = available.isPending || reserved.isPending;

  const setStatus = (next: StatusFilterValue) =>
    navigate({ search: { status: next === "available" ? undefined : next, page: undefined } });
  const setOffset = (offset: number) =>
    navigate({ search: (prev) => ({ ...prev, page: offset / PAGE_SIZE + 1 > 1 ? offset / PAGE_SIZE + 1 : undefined }) });

  return (
    <>
      {die ? (
        <PageHeader
          back={{ to: "/stock", label: t("stock.title") }}
          title={label}
          subtitle={[die.name, band ? t("stock.section.band", { band }) : null].filter(Boolean).join(" · ") || undefined}
          actions={
            <Button asChild variant="secondary">
              <Link to="/dies/$id" params={{ id: dieId }}>
                {t("stock.section.dieDetails")}
              </Link>
            </Button>
          }
        />
      ) : (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-11 w-24 rounded-full" />
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-5 w-72" />
        </div>
      )}

      {summaryLoading ? (
        <Skeleton className="h-[168px] w-full rounded-block sm:max-w-sm" />
      ) : (
        <div className="sm:max-w-sm" data-testid="section-hero">
          <StatusBlock
            tone="green"
            title={t("status.bundle.available")}
            meta={[
              t("stock.block.kg", { kg: formatKgTotal(gToKg(inStock.weightG)) }),
              held > 0 ? t("stock.heldChip", { count: held }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            value={inStock.bundles}
            unit={t("stock.block.unitInStock", { count: inStock.bundles })}
          />
        </div>
      )}

      <StatusFilter value={status} options={FILTERS} onChange={setStatus} />

      <BundleList
        rows={bundles.data?.items ?? []}
        total={bundles.data ? Number(bundles.data.total) : undefined}
        page={{ offset: offsetOf(search.page), limit: PAGE_SIZE, onChange: setOffset }}
        loading={bundles.isFetching}
        showSection={false}
        label={label ? t("stock.section.bundlesLabel", { section: label }) : t("stock.list.bundlesLabel")}
        empty={
          bundles.isError ? (
            <EmptyState
              title={t("stock.loadError")}
              action={
                <Button variant="secondary" onClick={() => void bundles.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t("stock.section.empty")} />
          )
        }
      />
    </>
  );
}
