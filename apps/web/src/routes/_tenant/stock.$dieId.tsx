import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { BundleList } from "@/features/stock/bundle-list";
import {
  PAGE_SIZE,
  offsetOf,
  pageWithinTotal,
  sectionDefaultStatus,
  validateSectionSearch,
} from "@/features/stock/bundle-search";
import { formatKgBand } from "@/features/stock/format";
import { failedWithoutData, resolveSectionPage } from "@/features/stock/section-page";
import { mergeSections, sectionHeadline } from "@/features/stock/sections";
import { StatusFilter, type StatusFilterValue } from "@/features/stock/status-filter";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

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
 *
 * A die deleted while its bundles are still on the floor keeps its page: the
 * header comes from the stock summary (or the die's bundles) and "Die
 * details" is left out (`resolveSectionPage`). The die is read with the plain
 * client, so a miss is this page's own state and never an English toast.
 */
function SectionPage() {
  const { t } = useT();
  const { dieId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const dieRead = useQuery({
    queryKey: ["stock", "sectionDie", dieId],
    queryFn: async () => {
      try {
        return await trpcClient.die.get.query({ id: dieId });
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  });
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
  const summaryFailed = failedWithoutData(available) || failedWithoutData(reserved);
  // Only when there is neither a die nor stock: does this section have any bundle at all?
  const probe = useQuery({
    ...trpc.bundle.listBundles.queryOptions({ dieId, limit: 1 }),
    enabled: dieRead.data === null && (summaryReady || summaryFailed) && !stock,
  });
  const page = resolveSectionPage({
    die: dieRead.data,
    dieFailed: failedWithoutData(dieRead),
    stock,
    summaryReady: summaryReady || summaryFailed,
    probe: probe.data
      ? { total: Number(probe.data.total), first: probe.data.items[0] }
      : probe.isError
        ? { total: 0 }
        : undefined,
  });

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

  // A page past the end (the list shrank, or an old link): go to the last page that has rows.
  const total = bundles.data && !bundles.isPlaceholderData ? Number(bundles.data.total) : undefined;
  useEffect(() => {
    if (total === undefined) return;
    const fixed = pageWithinTotal(search.page, total);
    if (fixed !== search.page) navigate({ search: (prev) => ({ ...prev, page: fixed }), replace: true });
  }, [total, search.page, navigate]);

  if (page.kind === "notFound") {
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

  const header = page.kind === "ready" ? page.header : null;
  const band = header ? formatKgBand(header.weightMinG, header.weightMaxG) : null;
  const setStatus = (next: StatusFilterValue) => navigate({ search: { status: next, page: undefined } });
  const setOffset = (offset: number) =>
    navigate({ search: (prev) => ({ ...prev, page: offset / PAGE_SIZE + 1 > 1 ? offset / PAGE_SIZE + 1 : undefined }) });

  return (
    <>
      {header ? (
        <PageHeader
          back={{ to: "/stock", label: t("stock.title") }}
          title={header.label}
          subtitle={[header.name, band ? t("stock.section.band", { band }) : null].filter(Boolean).join(" · ") || undefined}
          actions={
            header.dieListed ? (
              <Button asChild variant="secondary">
                <Link to="/dies/$id" params={{ id: dieId }}>
                  {t("stock.section.dieDetails")}
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : page.kind === "error" ? (
        <>
          <PageHeader back={{ to: "/stock", label: t("stock.title") }} title={t("stock.title")} />
          <div className="rounded-card border border-border bg-card">
            <EmptyState
              title={t("stock.loadError")}
              action={
                <Button variant="secondary" onClick={() => void dieRead.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          </div>
        </>
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
          {/* Same rule as the section's block: green in stock, blue when all held, neutral when empty.
              The status word is the title, so the unit is just "bundles". */}
          <StatusBlock
            tone={head.tone}
            title={
              head.state === "none"
                ? t("stock.section.nothingOnFloor")
                : t(head.state === "held" ? "status.bundle.reserved" : "status.bundle.available")
            }
            meta={
              head.state === "none"
                ? undefined
                : [
                    t("stock.block.kg", { kg: formatKgTotal(gToKg(head.weightG)) }),
                    head.state === "inStock" && head.held > 0
                      ? t("stock.heldKg", { count: head.held, kg: formatKgTotal(gToKg(head.heldWeightG)) })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
            }
            value={head.bundles}
            unit={head.state === "none" ? undefined : t("stock.section.heroUnit", { count: head.bundles })}
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
        label={header ? t("stock.section.bundlesLabel", { section: header.label }) : t("stock.list.bundlesLabel")}
        empty={
          failedWithoutData(bundles) ? (
            <EmptyState
              title={t("stock.loadError")}
              action={
                <Button variant="secondary" onClick={() => void bundles.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t(status === "all" ? "stock.section.emptyAll" : "stock.section.empty")} />
          )
        }
      />
    </>
  );
}
