import { bundleTone, formatKg, formatKgTotal, type BundleStatus } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { dieCode, sessionTotals } from "@/features/pack/pack-form";
import { useFormat } from "@/lib/use-format";
import { useLengthUnit } from "@/utils/length";
import { trpc } from "@/utils/trpc";

const STATUS_KEY: Record<BundleStatus, MessageKey> = {
  available: "status.bundle.available",
  reserved: "status.bundle.reserved",
  dispatched: "status.bundle.dispatched",
  void: "status.bundle.void",
};

export default function PackSessionScreen() {
  const { t } = useT();
  const router = useRouter();
  const fmt = useFormat();
  const length = useLengthUnit();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useQuery({ ...trpc.bundle.getGroup.queryOptions({ id: String(id) }), enabled: !!id });

  const data = session.data;
  const code = data?.group.code ?? "";
  const totals = data ? sessionTotals(data.bundles) : null;
  const when = data ? [fmt.day(data.group.createdAt), fmt.time(data.group.createdAt)].filter(Boolean).join(" ") : "";
  const notFound = (session.error as { data?: { code?: string } } | null)?.data?.code === "NOT_FOUND";

  return (
    <>
      <Stack.Screen options={{ title: code ? t("pack.detail.title", { code }) : t("nav.pack") }} />
      <Screen onRefresh={() => void session.refetch()} refreshing={session.isRefetching}>
        {session.isPending ? <LoadingBlock /> : null}
        {session.isError && !data ? (
          notFound ? (
            <Text className="font-sans text-[15px] text-ink-muted">{t("native.pack.notFound")}</Text>
          ) : (
            <ErrorBlock error={session.error} onRetry={() => void session.refetch()} retrying={session.isRefetching} />
          )
        ) : null}

        {data && totals ? (
          <>
            <PageHeader
              title={data.die ? dieCode(data.die) : code}
              subtitle={t("native.pack.packedAt", { when })}
            />
            <View className="gap-2 rounded-card border border-hairline bg-surface p-4">
              <Fact label={t("pack.columns.bundles")} value={String(totals.bundles)} />
              <Fact label={t("units.pcs")} value={String(totals.pieces)} />
              <Fact label={t("pack.columns.kg")} value={formatKgTotal(totals.kg)} />
              {data.group.purchaseOrderRef ? <Fact label={t("pack.new.po")} value={data.group.purchaseOrderRef} /> : null}
              {data.die ? <Fact label={t("pack.columns.section")} value={data.die.sectionCode} /> : null}
            </View>
            {totals.voidCount > 0 ? <Text className="font-sans text-sm text-ink-muted">{t("native.pack.voidNote")}</Text> : null}

            <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
              {t("native.pack.bundlesTitle")}
            </Text>
            <View className="gap-2">
              {data.bundles.map((b) => (
                <ListRow
                  key={b.id}
                  title={b.serial}
                  subtitle={`${formatKg(b.weightG / 1000)} ${t("units.kg")}, ${t("units.pieces", { count: b.quantity })}, ${length.formatLength(b.lengthMm)}`}
                  trailing={<Chip tone={bundleTone(b.status)} label={t(STATUS_KEY[b.status])} />}
                  accessibilityLabel={t("pack.detail.viewBundle", { serial: b.serial })}
                  onPress={() => router.push({ pathname: "/b/[serial]", params: { serial: b.serial } } as never)}
                />
              ))}
            </View>
          </>
        ) : null}
      </Screen>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="font-sans text-[15px] text-ink-muted">{label}</Text>
      <Text className="min-w-0 shrink font-mono-semibold text-base text-ink">{value}</Text>
    </View>
  );
}
