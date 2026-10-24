import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { StatusBlock } from "@/components/ui/status-block";
import { trpc } from "@/utils/trpc";

import { offsetOf, PAGE_SIZE, pageWithinTotal, parseBundlesParams, sectionDefaultStatus, type StatusFilterValue } from "./bundle-search";
import { BundleRows, Pager } from "./bundle-list";
import { formatKgBand } from "./format";
import { failedWithoutData, resolveSectionPage } from "./section-page";
import { mergeSections, sectionHeadline, type SummaryRow } from "./sections";
import { StatusFilter } from "./status-filter";
import { useRefresh } from "./use-refresh";

function isNotFound(error: unknown): boolean {
  return (error as { data?: { code?: unknown } } | null)?.data?.code === "NOT_FOUND";
}

/**
 * One section's page: its stock as the hero (green in stock, blue when all
 * held, neutral when empty), the die's kg/12ft band, a link to the die, and
 * its bundles with a status filter. Opens on In stock (or Held when every
 * bundle is held, All when nothing is on the floor). A die deleted while its
 * bundles are still on the floor keeps its page, titled from the stock summary.
 */
export function SectionView() {
  const { t } = useT();
  const router = useRouter();
  const raw = useLocalSearchParams<{ dieId: string; status?: string }>();
  const dieId = Array.isArray(raw.dieId) ? raw.dieId[0]! : raw.dieId;
  const paramStatus = parseBundlesParams({ status: raw.status }).status;

  const dieRead = useQuery({ ...trpc.die.get.queryOptions({ id: dieId }), retry: false });
  const available = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "available" }));
  const reserved = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "reserved" }));
  const stock = useMemo(
    () =>
      available.data && reserved.data
        ? mergeSections(available.data.items as SummaryRow[], reserved.data.items as SummaryRow[]).find((s) => s.dieId === dieId)
        : undefined,
    [available.data, reserved.data, dieId],
  );
  const summaryReady = Boolean(available.data && reserved.data);
  const summaryFailed = failedWithoutData(available) || failedWithoutData(reserved);

  const dieMissing = dieRead.isError && isNotFound(dieRead.error);
  const dieFailed = dieRead.isError && !dieMissing;
  const probe = useQuery({
    ...trpc.bundle.listBundles.queryOptions({ dieId, limit: 1 }),
    enabled: dieMissing && (summaryReady || summaryFailed) && !stock,
  });
  const page = resolveSectionPage({
    die: dieRead.data ?? (dieMissing ? null : undefined),
    dieFailed,
    stock,
    summaryReady: summaryReady || summaryFailed,
    probe: probe.data ? { total: Number(probe.data.total), first: probe.data.items[0] } : probe.isError ? { total: 0 } : undefined,
  });

  const head = sectionHeadline(stock);
  const [picked, setPicked] = useState<StatusFilterValue | null>(paramStatus ?? null);
  const [pageNo, setPageNo] = useState(1);
  // No choice yet: open where the section's bundles are (wait for the summary, else In stock).
  const status: StatusFilterValue | null = picked ?? (summaryReady ? sectionDefaultStatus(head.state) : summaryFailed ? "available" : null);

  const bundles = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
      dieId,
      status: status === "all" || status === null ? undefined : status,
      limit: PAGE_SIZE,
      offset: offsetOf(pageNo),
    }),
    enabled: status !== null,
    placeholderData: keepPreviousData,
  });
  const total = bundles.data && !bundles.isPlaceholderData ? Number(bundles.data.total) : undefined;
  useEffect(() => {
    if (total === undefined) return;
    const fixed = pageWithinTotal(pageNo, total);
    if (fixed !== pageNo) setPageNo(fixed);
  }, [total, pageNo]);

  const { refreshing, onRefresh } = useRefresh([dieRead.refetch, available.refetch, reserved.refetch, bundles.refetch]);

  const header = page.kind === "ready" ? page.header : null;
  const band = header ? formatKgBand(header.weightMinG, header.weightMaxG) : null;
  const title = header?.label ?? t("stock.title");

  if (page.kind === "notFound") {
    return (
      <Screen>
        <Stack.Screen options={{ title: t("stock.title") }} />
        <EmptyState title={t("errors.notFoundInCompany")} actionLabel={t("stock.title")} onAction={() => router.replace("/stock")} />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ title }} />
      {header ? (
        <PageHeader
          title={header.label}
          subtitle={[header.name, band ? t("stock.section.band", { band }) : null].filter(Boolean).join(" · ") || undefined}
        />
      ) : page.kind === "error" ? (
        <ErrorBlock error={dieRead.error} onRetry={() => void dieRead.refetch()} />
      ) : (
        <LoadingBlock />
      )}

      {header?.dieListed ? (
        <Button variant="secondary" label={t("stock.section.dieDetails")} onPress={() => router.push(`/more/dies/${encodeURIComponent(dieId)}`)} />
      ) : null}

      {summaryReady ? (
        <StatusBlock
          tone={head.tone}
          title={head.state === "none" ? t("stock.section.nothingOnFloor") : t(head.state === "held" ? "status.bundle.reserved" : "status.bundle.available")}
          meta={
            head.state === "none"
              ? undefined
              : [
                  t("stock.block.kg", { kg: formatKgTotal(gToKg(head.weightG)) }),
                  head.state === "inStock" && head.held > 0 ? t("stock.heldKg", { count: head.held, kg: formatKgTotal(gToKg(head.heldWeightG)) }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          value={head.bundles}
          unit={head.state === "none" ? undefined : t("stock.section.heroUnit", { count: head.bundles })}
        />
      ) : summaryFailed ? null : (
        <LoadingBlock />
      )}

      {status === null ? null : (
        <StatusFilter
          value={status}
          onChange={(next) => {
            setPicked(next);
            setPageNo(1);
          }}
        />
      )}

      {failedWithoutData(bundles) ? (
        <ErrorBlock error={bundles.error} onRetry={() => void bundles.refetch()} retrying={bundles.isFetching} />
      ) : bundles.isPending || status === null ? (
        <LoadingBlock />
      ) : bundles.data && bundles.data.items.length > 0 ? (
        <>
          <BundleRows rows={bundles.data.items} showSection={false} />
          <Pager page={pageNo} total={Number(bundles.data.total)} onChange={setPageNo} />
        </>
      ) : (
        <EmptyState title={t(status === "all" ? "stock.section.emptyAll" : "stock.section.empty")} />
      )}
    </Screen>
  );
}
