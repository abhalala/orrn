import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT, type Translate } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useRefresh } from "@/features/stock/use-refresh";
import { useFormat } from "@/lib/use-format";
import { useLengthUnit } from "@/utils/length";
import { trpc } from "@/utils/trpc";

import { HandoverSheet } from "./handover-sheet";
import { canHandover, gateTexts, isOpenRun, recoveryText, runBanner, type BannerTone } from "./press-model";

const isNotFound = (error: unknown) => (error as { data?: { code?: unknown } } | null)?.data?.code === "NOT_FOUND";

const BANNER_BOX: Record<BannerTone, string> = {
  neutral: "bg-surface-sunken",
  blue: "bg-tone-blue-tint",
  green: "bg-tone-green-tint",
  amber: "bg-tone-amber-tint",
  red: "bg-tone-red-tint",
};
const BANNER_TEXT: Record<BannerTone, string> = {
  neutral: "text-ink",
  blue: "text-tone-blue-ink",
  green: "text-tone-green-ink",
  amber: "text-tone-amber-ink",
  red: "text-tone-red-ink",
};

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="font-sans text-[15px] text-ink-muted">{label}</Text>
      <Text className="min-w-0 shrink font-mono-semibold text-base text-ink">{value}</Text>
    </View>
  );
}

const kgText = (t: Translate, g: number | null | undefined) => (g == null || g === 0 ? null : `${formatKgTotal(gToKg(g))} ${t("units.kg")}`);

/**
 * One press run, read only: the state banner (a run waiting for its die says "Die not issued. Start is
 * locked."), the people, the times, the figures and what is still missing before the supervisor can log
 * it. There is no Start, Stop or Count here: they are on the press tablet. Handover is the one write.
 */
export function PressRunView() {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  const lu = useLengthUnit();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ ...trpc.press.runs.get.queryOptions({ id }), refetchInterval: (query) => (query.state.data?.run.status === "running" ? 10_000 : 30_000) });
  const { refreshing, onRefresh } = useRefresh([q.refetch]);
  const [handover, setHandover] = useState(false);

  const data = q.data;
  const run = data?.run;
  const banner = run ? runBanner(run.status) : null;
  const logged = run?.status === "logged";
  // A logged run shows what was stored; an open one the live figures the server worked out.
  const figs = data ? (logged ? data.run.stored : data.figures) : null;
  const recovery = figs ? recoveryText(figs.recoveryBp) : null;
  const gates = data && run?.status === "counting" ? gateTexts(t, data.gates) : [];

  return (
    <>
      <Stack.Screen options={{ title: run?.number ?? t("native.tabs.press") }} />
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        {q.isPending ? (
          <LoadingBlock />
        ) : !data || !run || !banner ? (
          isNotFound(q.error) ? (
            <EmptyState title={t("errors.notFoundInCompany")} actionLabel={t("native.tabs.press")} onAction={() => router.replace("/press")} />
          ) : (
            <ErrorBlock error={q.error} onRetry={() => void q.refetch()} retrying={q.isRefetching} />
          )
        ) : (
          <>
            <View accessible accessibilityLiveRegion="polite" accessibilityLabel={`${t(banner.headline)}${banner.detail ? `. ${t(banner.detail)}` : ""}`} className={cn("gap-1 rounded-block p-[18px]", BANNER_BOX[banner.tone])}>
              <Text className={cn("font-display-bold text-2xl", BANNER_TEXT[banner.tone])}>{t(banner.headline)}</Text>
              {banner.detail ? <Text className={cn("font-sans-medium text-[15px] leading-6", BANNER_TEXT[banner.tone])}>{t(banner.detail)}</Text> : null}
              {run.status === "running" && run.startedAt ? (
                <Text className={cn("font-mono-semibold text-base", BANNER_TEXT[banner.tone])}>{t("native.press.runningSince", { time: format.time(run.startedAt) ?? "" })}</Text>
              ) : null}
              {run.timeUnconfirmed ? <Text className={cn("font-sans text-sm", BANNER_TEXT[banner.tone])}>{t("press.console.timeUnconfirmed")}</Text> : null}
            </View>

            <View className="gap-2 rounded-card border border-hairline bg-surface p-4">
              <Text className="font-display-bold text-xl text-ink">{[run.series, run.sectionCode].filter(Boolean).join(" ")}</Text>
              {run.sectionName ? <Text className="font-sans text-[15px] text-ink-muted">{run.sectionName}</Text> : null}
              <Fact label={t("native.press.line")} value={data.line?.code} />
              <Fact label={t("native.press.dieCopy")} value={data.copy?.code} />
              <Fact label={t("press.console.cast")} value={run.castNumber} />
              <Fact label={t("press.console.productionDay")} value={run.productionDay ? (format.day(run.productionDay) ?? run.productionDay) : null} />
              <Fact label={t("press.console.operator")} value={run.operatorName} />
              <Fact label={t("press.console.relief")} value={run.reliefOperatorName} />
              <Fact label={t("press.console.supervisor")} value={run.supervisorName} />
              <Fact label={t("native.press.startedAt")} value={run.startedAt ? `${format.day(run.startedAt) ?? ""} ${format.time(run.startedAt) ?? ""}`.trim() : null} />
              <Fact label={t("native.press.stoppedAt")} value={run.stoppedAt ? `${format.day(run.stoppedAt) ?? ""} ${format.time(run.stoppedAt) ?? ""}`.trim() : null} />
            </View>

            {data.planLines.length > 0 ? (
              <View className="gap-2 rounded-card border border-hairline bg-surface p-4">
                <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
                  {t("native.press.jobHeading")}
                </Text>
                {data.planLines.map((l) => (
                  <Text key={l.id} className="font-mono text-sm text-ink">
                    {t("native.press.jobLine", { order: l.orderNumber, length: lu.formatLength(l.cutLengthMm), pcs: l.pcs, kg: formatKgTotal(gToKg(l.kgG)) })}
                  </Text>
                ))}
                <Text className="font-mono-semibold text-[15px] text-ink">
                  {t("native.press.jobTotals", { pcs: data.planTotals.pcs, kg: formatKgTotal(gToKg(data.planTotals.kgG)) })}
                </Text>
              </View>
            ) : null}

            {figs && ((figs.inputG ?? 0) > 0 || (figs.goodG ?? 0) > 0) ? (
              <View className="gap-2 rounded-card border border-hairline bg-surface p-4">
                <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
                  {logged ? t("native.press.figuresLogged") : t("native.press.figuresLive")}
                </Text>
                <Fact label={t("press.console.input")} value={kgText(t, figs.inputG)} />
                <Fact label={t("press.console.good")} value={kgText(t, figs.goodG)} />
                <Fact label={t("press.console.reject")} value={kgText(t, figs.rejectG)} />
                <Fact label={t("press.console.recovery")} value={recovery ? `${recovery}%` : null} />
                {!logged && "balanceWarn" in figs && figs.balanceWarn ? (
                  <Text className="font-sans text-sm text-tone-amber-ink">{t("press.console.balanceWarn", { pct: 2 })}</Text>
                ) : null}
              </View>
            ) : null}

            {data.downtime.length > 0 ? (
              <View className="gap-2 rounded-card border border-hairline bg-surface p-4">
                <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
                  {t("press.console.downtime")}
                </Text>
                <Text className="font-mono-semibold text-base text-ink">{t("native.press.downtimeTotal", { minutes: data.downtimeMin })}</Text>
              </View>
            ) : null}

            {gates.length > 0 ? (
              <View className="gap-2 rounded-card bg-tone-amber-tint p-4">
                <Text accessibilityRole="header" className="font-sans-semibold text-base text-tone-amber-ink">
                  {t("native.press.gatesHeading")}
                </Text>
                {gates.map((g, i) => (
                  <Text key={`${i}:${g}`} className="font-sans text-[15px] leading-6 text-tone-amber-ink">
                    {g}
                  </Text>
                ))}
              </View>
            ) : null}

            {isOpenRun(run.status) && canHandover(run.status) ? (
              <Can do="press.run">
                <Button variant="secondary" label={t("native.press.handoverTitle")} onPress={() => setHandover(true)} />
              </Can>
            ) : null}
          </>
        )}
      </Screen>
      {handover ? <HandoverSheet runId={id} visible onClose={() => setHandover(false)} /> : null}
    </>
  );
}
