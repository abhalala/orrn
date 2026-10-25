import { useT } from "@orrn/i18n";
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
import { trpc } from "@/utils/trpc";

import { DowntimePanel } from "./downtime-panel";
import { HandoverSheet } from "./handover-sheet";
import { JobCardView } from "./job-card";
import { BOARD_POLL_MS } from "./lines-view";
import { canHandover, splitCards, type JobCard } from "./press-model";

const isNotFound = (error: unknown) => (error as { data?: { code?: unknown } } | null)?.data?.code === "NOT_FOUND";

/**
 * One press line: the job cards of its queue (read only), downtime start and stop, and the handover of the
 * run on the press. Starting, stopping and counting are on the tablet at the press.
 */
export function PressLineView() {
  const { t } = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queue = useQuery({ ...trpc.press.queue.list.queryOptions({ pressLineId: id }), refetchInterval: BOARD_POLL_MS });
  const { refreshing, onRefresh } = useRefresh([queue.refetch]);
  const [handoverFor, setHandoverFor] = useState<string | null>(null);

  const cards = (queue.data?.cards ?? []) as JobCard[];
  const { onPress, waiting } = splitCards(cards);
  const handoverRun = onPress.find((c) => canHandover(c.status)) ?? waiting.find((c) => canHandover(c.status));
  const open = (card: JobCard) => router.push({ pathname: "/press/run/[id]", params: { id: card.id } } as never);

  return (
    <>
      <Stack.Screen options={{ title: queue.data?.line.code ?? t("native.tabs.press") }} />
      <Screen onRefresh={onRefresh} refreshing={refreshing}>
        {queue.isPending ? (
          <LoadingBlock />
        ) : !queue.data ? (
          isNotFound(queue.error) ? (
            <EmptyState title={t("errors.notFoundInCompany")} actionLabel={t("native.tabs.press")} onAction={() => router.replace("/press")} />
          ) : (
            <ErrorBlock error={queue.error} onRetry={() => void queue.refetch()} retrying={queue.isRefetching} />
          )
        ) : (
          <>
            <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("native.press.stationNote")}</Text>

            <DowntimePanel pressLineId={id} />

            {handoverRun ? (
              <Can do="press.run">
                <Button variant="secondary" label={t("native.press.handoverTitle")} onPress={() => setHandoverFor(handoverRun.id)} />
              </Can>
            ) : null}

            {onPress.length > 0 ? (
              <View className="gap-3">
                <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
                  {t("native.press.onPress")}
                </Text>
                {onPress.map((c) => (
                  <JobCardView key={c.id} card={c} onOpen={() => open(c)} />
                ))}
              </View>
            ) : null}

            <View className="gap-3">
              <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
                {t("press.console.queue")}
              </Text>
              {waiting.length === 0 ? <Text className="font-sans text-[15px] text-ink-muted">{t("press.console.noRuns")}</Text> : null}
              {waiting.map((c) => (
                <JobCardView key={c.id} card={c} onOpen={() => open(c)} />
              ))}
            </View>
          </>
        )}
      </Screen>
      {handoverFor ? <HandoverSheet runId={handoverFor} visible onClose={() => setHandoverFor(null)} /> : null}
    </>
  );
}
