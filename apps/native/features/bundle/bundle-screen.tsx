import { bundleTone, type BundleStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HowToButton } from "@/components/ui/how-to-button";
import { ListRow } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { StatusBlock } from "@/components/ui/status-block";
import { needsResolve } from "@/features/scan/scan-flow";
import { useRefresh } from "@/features/stock/use-refresh";
import { useFormat } from "@/lib/use-format";
import { can, useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import { AddToDispatchSheet } from "./add-to-dispatch-sheet";
import { BundleFacts } from "./facts";
import { NoticeBanner, type BundleNotice } from "./notice";
import { buildTimeline } from "./timeline";
import { BundleTimeline } from "./timeline-view";
import { TransitionSheet } from "./transition-sheet";

function useBundleDetail(serial: string, enabled: boolean) {
  return useQuery({ ...trpc.bundle.getBySerial.queryOptions({ serial }), enabled });
}

function isNotFound(error: unknown): boolean {
  return (error as { data?: { code?: unknown } } | null)?.data?.code === "NOT_FOUND";
}

/**
 * `/b/<serial>`: what a label QR and a scan open. The code can be any printed
 * format (plant number `26I4086`, old month-only `J540`, legacy id, `BG-`
 * serial): a stored number is read straight away; the others are resolved
 * first (`resolve.byCode`), and a number that fits several years asks which.
 */
export function BundleScreen() {
  const { t } = useT();
  const router = useRouter();
  const raw = useLocalSearchParams<{ serial: string }>();
  const serial = Array.isArray(raw.serial) ? raw.serial[0]! : raw.serial;
  const needs = needsResolve(serial);

  const resolved = useQuery({ ...trpc.resolve.byCode.queryOptions({ code: serial }), enabled: needs });
  const hit = resolved.data;
  const number = !needs ? serial : hit?.kind === "bundle" ? hit.number : undefined;

  const detail = useBundleDetail(number ?? serial, number !== undefined);
  const { refreshing, onRefresh } = useRefresh([resolved.refetch, detail.refetch]);
  const [notice, setNotice] = useState<BundleNotice | null>(null);

  const title = <Stack.Screen options={{ title: t("bundle.title", { serial: number ?? serial }) }} />;

  if (needs && resolved.isPending) return <Screen>{title}<LoadingBlock /></Screen>;
  if (needs && resolved.isError) {
    return (
      <Screen>
        {title}
        <ErrorBlock error={resolved.error} onRetry={() => void resolved.refetch()} retrying={resolved.isFetching} />
      </Screen>
    );
  }
  if (hit?.kind === "ambiguous") {
    return (
      <Screen>
        {title}
        <PageHeader title={t("bundle.ambiguousTitle")} subtitle={t("bundle.ambiguousBody", { code: serial })} />
        <View className="gap-2">
          {hit.candidates.map((c) => (
            <ListRow key={c.bundleId} title={c.number} subtitle={t("scan.madeIn", { year: c.year })} onPress={() => router.replace(`/b/${encodeURIComponent(c.number)}`)} />
          ))}
        </View>
      </Screen>
    );
  }
  const notFound = hit?.kind === "not_found" || (detail.isError && isNotFound(detail.error));
  if (notFound) {
    return (
      <Screen>
        {title}
        <EmptyState title={t("errors.notFoundInCompany")} body={serial} actionLabel={t("errors.goToday")} onAction={() => router.replace("/today")} />
      </Screen>
    );
  }
  if (detail.isError && !detail.data) {
    return (
      <Screen>
        {title}
        <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />
      </Screen>
    );
  }
  if (!detail.data) return <Screen>{title}<LoadingBlock /></Screen>;

  return (
    <BundleDetail
      data={detail.data}
      notice={notice}
      onNotice={setNotice}
      refreshing={refreshing}
      onRefresh={onRefresh}
      refetch={() => void detail.refetch()}
    />
  );
}

type DetailData = NonNullable<ReturnType<typeof useBundleDetail>["data"]>;

function BundleDetail({
  data,
  notice,
  onNotice,
  refreshing,
  onRefresh,
  refetch,
}: {
  data: DetailData;
  notice: BundleNotice | null;
  onNotice: (n: BundleNotice | null) => void;
  refreshing: boolean;
  onRefresh: () => void;
  refetch: () => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const fmt = useFormat();
  const { bundle, die, group, activeDispatch, events } = data;
  const [addOpen, setAddOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  const timeline = useMemo(() => buildTimeline(events, bundle), [events, bundle]);
  const section = die ? [die.series, die.sectionCode].filter(Boolean).join(" ") : null;
  const sub = [section, die?.name].filter(Boolean).join(" · ");
  const status: BundleStatus = bundle.status;
  const { data: me } = useMe();
  const transitionTo = status === "available" ? "void" : status === "void" ? "available" : null;
  const canAdd = status === "available" && can(me, "dispatch.addBundle");
  const canTransition = transitionTo !== null && can(me, "bundle.void");
  const packedAt = [fmt.day(bundle.createdAt), fmt.time(bundle.createdAt)].filter(Boolean).join(", ");

  const done = (next: BundleNotice) => {
    onNotice(next);
    refetch();
  };

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: t("bundle.title", { serial: bundle.serial }) }} />
      {notice ? (
        <NoticeBanner
          notice={notice}
          actionLabel={notice.dispatchId ? t("bundle.openDispatchPlain") : undefined}
          onAction={notice.dispatchId ? () => router.push(`/dispatch/${encodeURIComponent(notice.dispatchId!)}`) : undefined}
        />
      ) : null}

      <StatusBlock tone={bundleTone(status)} title={t(`status.bundle.${status}`)} meta={sub || undefined} value={bundle.serial} />

      {activeDispatch ? (
        <ListRow title={t("bundle.inDispatch", { code: activeDispatch.code })} accessibilityHint={t("bundle.openDispatchPlain")} onPress={() => router.push(`/dispatch/${encodeURIComponent(activeDispatch.id)}`)} />
      ) : null}

      {canAdd || canTransition ? (
        <View accessibilityLabel={t("bundle.actionsLabel")} className="gap-2">
          {canAdd ? <Button size="lg" label={t("bundle.addToDispatch")} onPress={() => setAddOpen(true)} /> : null}
          {canTransition ? (
            <Button variant="secondary" label={t(transitionTo === "void" ? "bundle.void" : "bundle.restore")} onPress={() => setTransitionOpen(true)} />
          ) : null}
        </View>
      ) : null}

      <BundleFacts bundle={bundle} die={die} group={group} packedAt={packedAt} />
      <BundleTimeline entries={timeline} activeDispatch={activeDispatch} />

      <View className="flex-row flex-wrap gap-x-2">
        <HowToButton slug="reprint-label" label={t("bundle.howToReprint")} />
        <HowToButton slug="void-bundle" label={t("bundle.howToVoid")} />
      </View>

      {canAdd ? <AddToDispatchSheet visible={addOpen} onClose={() => setAddOpen(false)} serial={bundle.serial} onDone={done} /> : null}
      {canTransition && transitionTo ? (
        <TransitionSheet visible={transitionOpen} onClose={() => setTransitionOpen(false)} bundleId={bundle.id} to={transitionTo} onDone={done} />
      ) : null}
    </Screen>
  );
}
