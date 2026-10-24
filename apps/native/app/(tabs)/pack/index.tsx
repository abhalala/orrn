import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HowToButton } from "@/components/ui/how-to-button";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { dieCode } from "@/features/pack/pack-form";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

const PAGE = 50;

export default function PackScreen() {
  const { t } = useT();
  const router = useRouter();
  const fmt = useFormat();
  const [limit, setLimit] = useState(PAGE);
  const sessions = useQuery({ ...trpc.bundle.listGroups.queryOptions({ limit }), placeholderData: (prev) => prev });
  const items = sessions.data?.items ?? [];
  const total = Number(sessions.data?.total ?? 0);

  const startNew = () => router.push("/pack/new" as never);

  return (
    <Screen onRefresh={() => void sessions.refetch()} refreshing={sessions.isRefetching && !sessions.isPending}>
      <View className="flex-row items-center justify-between gap-3">
        <HowToButton slug="pack-session" />
      </View>
      <Can do="bundle.create">
        <Button size="lg" label={t("pack.newSession")} onPress={startNew} />
      </Can>

      {sessions.isPending ? <LoadingBlock /> : null}
      {sessions.isError && !sessions.data ? (
        <ErrorBlock error={sessions.error} onRetry={() => void sessions.refetch()} retrying={sessions.isRefetching} />
      ) : null}

      {sessions.data && items.length === 0 ? (
        <Can do="bundle.create" fallback={<EmptyState title={t("pack.empty")} />}>
          <EmptyState title={t("pack.empty")} actionLabel={t("pack.emptyAction")} onAction={startNew} />
        </Can>
      ) : null}

      {items.length > 0 ? (
        <View className="gap-2">
          {items.map((s) => {
            const when = [fmt.day(s.createdAt), fmt.time(s.createdAt)].filter(Boolean).join(" ");
            return (
              <ListRow
                key={s.id}
                title={s.code}
                subtitle={`${dieCode({ series: s.dieSeries, sectionCode: s.dieSectionCode })}, ${when}`}
                trailing={
                  <View className="items-end">
                    <Text className="font-mono-semibold text-base text-ink">{formatKgTotal(gToKg(Number(s.totalWeightG)))}</Text>
                    <Text className="font-sans text-xs text-ink-muted">{t("units.bundles", { count: Number(s.bundleCount) })}</Text>
                  </View>
                }
                accessibilityLabel={t("native.pack.openSession", { code: s.code })}
                onPress={() => router.push({ pathname: "/pack/[id]", params: { id: s.id } } as never)}
              />
            );
          })}
          {items.length < total ? (
            <Button variant="secondary" label={t("native.pack.showMore")} loading={sessions.isFetching} onPress={() => setLimit((n) => Math.min(100, n + PAGE))} />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
