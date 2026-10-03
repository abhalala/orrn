import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { BundleList } from "@/features/stock/bundle-list";
import { PAGE_SIZE, offsetOf, sectionDefaultStatus, validateSectionSearch } from "@/features/stock/bundle-search";
import { formatKgBand } from "@/features/stock/format";
import { mergeSections, sectionHeadline, sectionLabel } from "@/features/stock/sections";
import { StatusFilter, type StatusFilterValue } from "@/features/stock/status-filter";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

const FILTERS: readonly StatusFilterValue[] = ["all", "available", "reserved", "dispatched", "void"];

export const Route = createFileRoute("/_tenant/stock/$dieId")({
  validateSearch: validateSectionSearch,
  component: SectionPage,
});

/**
 * `/stock/$dieId`: one section's bundles, opening on In stock (or Held when
 * every bundle is held, All when nothing is on the floor), with chips for
 * every status. The hero block is the section's stock, coloured by the same
 * rule as its block on Sections; the die's kg/12ft band sits under the title.
 */
function SectionPage() {
  const { t } = useT();
  const { dieId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const dieQuery = useQuery({ ...trpc.die.get.queryOptions({ id: dieId }), retry: false });
  const available = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "available" }));
  const reserved = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "reserved" }));
  const stock = useMemo(
    () =>
      available.data && reserved.data
        ? mergeSections(available.data.items, reserved.data.items).find((s) => s.dieId === dieId)
        : undefined,
    [available.data, reserved.data, dieId],
  );
  const summaryReady = Boolean(available.data && reserved.data);
  const summaryFailed = available.isError || reserved.isError;
  const head = sectionHeadline(stock);
  // No chip in the URL: open where the section's bundles are (wait for the summary, else In stock).
  const status: StatusFilterValue | null =
    search.status ?? (summaryReady ? sectionDefaultStatus(head.state) : summaryFailed ? "available" : null);

  const bundles = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
      dieId,
      status: status === "all" || status === null ? undefined : status,
      limit: PAGE_SIZE,
      offset: offsetOf(search.page),
    }),
    enabled: status !== null,
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
  const setStatus = (next: StatusFilterValue) => navigate({ search: { status: next, page: undefined } });
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

      {summaryFailed ? null : !summaryReady ? (
        <Skeleton className="h-[168px] w-full rounded-block sm:max-w-sm" />
      ) : (
        <div className="sm:max-w-sm" data-testid="section-hero" data-tone={head.tone}>
          {/* Same rule as the section's block: green in stock, blue when all held, neutral when empty. */}
          <StatusBlock
            tone={head.tone}
            title={t(head.state === "held" ? "status.bundle.reserved" : "status.bundle.available")}
            meta={
              head.state === "none"
                ? undefined
                : [
                    t("stock.block.kg", { kg: formatKgTotal(gToKg(head.weightG)) }),
                    head.state === "inStock" && head.held > 0 ? t("stock.heldChip", { count: head.held }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
            }
            value={head.bundles}
            unit={t(head.state === "held" ? "stock.block.unitHeld" : "stock.block.unitInStock", { count: head.bundles })}
          />
        </div>
      )}

      {status === null ? (
        <Skeleton className="h-11 w-full max-w-md rounded-full" />
      ) : (
        <StatusFilter value={status} options={FILTERS} onChange={setStatus} />
      )}

      <BundleList
        rows={bundles.data?.items ?? []}
        total={bundles.data ? Number(bundles.data.total) : undefined}
        page={{ offset: offsetOf(search.page), limit: PAGE_SIZE, onChange: setOffset }}
        loading={status === null || bundles.isFetching}
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
