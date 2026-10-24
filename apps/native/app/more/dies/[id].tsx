import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { StatusBlock } from "@/components/ui/status-block";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { dieCode, dieMeasurements, kgText, measurementText } from "@/features/dies/die-display";
import { isNotFound } from "@/features/more/query-errors";
import { useLengthUnit } from "@/utils/length";
import { trpc } from "@/utils/trpc";

/**
 * One die, read only: its weight band per 12 ft, measurements in the company's
 * length unit, notes, and a way to its stock. Adding and editing dies stays on
 * the web (the die room works at a desk).
 */
export default function DieScreen() {
  const { t } = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { unit } = useLengthUnit();
  const [refreshing, setRefreshing] = useState(false);
  const query = useQuery({ ...trpc.die.get.queryOptions({ id: id ?? "" }), enabled: !!id, retry: false });

  const refresh = () => {
    setRefreshing(true);
    void query.refetch().finally(() => setRefreshing(false));
  };

  if (query.data === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t("nav.dies") }} />
        {query.isError ? (
          isNotFound(query.error) ? (
            <EmptyState
              title={t("dies.detail.notFound")}
              actionLabel={t("dies.detail.backToList")}
              onAction={() => (router.canGoBack() ? router.back() : router.replace("/more/dies"))}
            />
          ) : (
            <ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
          )
        ) : (
          <LoadingBlock />
        )}
      </Screen>
    );
  }

  const die = query.data;
  const code = dieCode(die);
  const units = { mm: t("units.mm"), inch: t("units.inch") };
  const measurements = dieMeasurements(die);

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: code }} />
      <PageHeader title={code} subtitle={die.name ?? undefined} />

      <StatusBlock
        tone={die.status === "active" ? "green" : "neutral"}
        title={t("dies.detail.band")}
        meta={t(`status.die.${die.status}`)}
        value={t("dies.detail.bandValue", { min: kgText(die.weightMinG), max: kgText(die.weightMaxG) })}
        unit={t("units.kgPer12ft")}
      />

      <View className="gap-4 rounded-card border border-hairline bg-surface p-5">
        <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
          {t("dies.detail.measurements")}
        </Text>
        {measurements.length > 0 ? (
          <View className="flex-row flex-wrap gap-x-4 gap-y-3">
            {measurements.map((m) => (
              <View key={m.field} accessible accessibilityLabel={`${t(`dies.form.${m.field}`)}, ${measurementText(m.mm, unit, units)}`} className="min-w-[40%] flex-1 gap-0.5">
                <Text className="font-sans-medium text-[13px] text-ink-muted">{t(`dies.form.${m.field}`)}</Text>
                <Text className="font-mono-semibold text-[17px] text-ink">
                  {measurementText(m.mm, unit, units)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text className="font-sans text-[15px] text-ink-muted">{t("dies.detail.noMeasurements")}</Text>
        )}
        {die.notes ? (
          <View className="gap-0.5 border-t border-hairline pt-3">
            <Text className="font-sans-medium text-[13px] text-ink-muted">{t("dies.form.notes")}</Text>
            <Text className="font-sans text-[15px] leading-6 text-ink">{die.notes}</Text>
          </View>
        ) : null}
      </View>

      <Button
        variant="secondary"
        size="lg"
        label={t("dies.detail.seeStock")}
        onPress={() => router.push({ pathname: "/stock/[dieId]", params: { dieId: die.id } })}
      />
    </Screen>
  );
}
