import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useRefresh } from "@/features/stock/use-refresh";
import { trpc } from "@/utils/trpc";

import { lineState, type LineRow } from "./press-model";

/** How often the line board looks again while it is open: the press changes by the minute, not the second. */
export const BOARD_POLL_MS = 15_000;

function stateChip(t: ReturnType<typeof useT>["t"], line: LineRow) {
  const s = lineState(line);
  if (s.kind === "downtime") return <Chip tone="red" label={t("native.press.lineDowntime")} />;
  if (s.kind === "running") return <Chip tone="green" label={t("native.press.lineRunning", { number: s.number })} />;
  return <Chip tone="neutral" label={t("native.press.lineIdle")} />;
}

/**
 * The Press tab for the press role: every press line with what it is doing now. Tapping a line opens its
 * queue. Nothing here starts or stops a run: that is the tablet at the press.
 */
export function PressLines() {
  const { t } = useT();
  const router = useRouter();
  const lines = useQuery({ ...trpc.press.lines.list.queryOptions({ includeRetired: false }), refetchInterval: BOARD_POLL_MS });
  const { refreshing, onRefresh } = useRefresh([lines.refetch]);
  const rows = (lines.data ?? []) as LineRow[];

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      {lines.isPending ? (
        <LoadingBlock />
      ) : lines.isError && !lines.data ? (
        <ErrorBlock error={lines.error} onRetry={() => void lines.refetch()} retrying={lines.isRefetching} />
      ) : rows.length === 0 ? (
        <EmptyState title={t("native.press.noLines")} />
      ) : (
        <>
          <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("native.press.stationNote")}</Text>
          <View accessibilityLabel={t("native.press.linesHeading")} className="gap-3">
            {rows.map((line) => (
              <ListRow
                key={line.id}
                title={line.code}
                subtitle={[line.name, t("native.press.lineQueued", { count: line.queued })].filter(Boolean).join(", ")}
                trailing={stateChip(t, line)}
                accessibilityLabel={`${line.code}, ${lineState(line).kind === "running" ? t("native.press.lineRunning", { number: line.running ?? "" }) : lineState(line).kind === "downtime" ? t("native.press.lineDowntime") : t("native.press.lineIdle")}, ${t("native.press.lineQueued", { count: line.queued })}`}
                onPress={() => router.push({ pathname: "/press/line/[id]", params: { id: line.id } } as never)}
              />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
