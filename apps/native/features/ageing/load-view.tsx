import Feather from "@expo/vector-icons/Feather";
import { ageingCapacity, AGEING_LOAD_MAX_ROWS, formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { NumberInput } from "@/components/ui/number-input";
import { PageHeader } from "@/components/ui/page-header";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useDebounced } from "@/features/more/use-debounced";
import { announce } from "@/lib/a11y";
import { useThemeColor } from "@/lib/theme";
import { can, useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import { canLoad, capacityTone, loadTotals, pickOf, pressRowsOf, type PickState } from "./model";
import { ErrorLine, Note } from "./ui";
import { useAgeingRefresh, useKeyedWrite, type AvailableBundle, type AvailableLine } from "./use-ageing";

type Source = "press" | "bundles";

const kgText = (g: number) => formatKgTotal(gToKg(g));

/**
 * Load a trolley (FP-AG-16, ageing.load): pick a free trolley, then the logged press lines (pieces default to
 * all that are left) or whole packed bundles that go on it. The capacity chip is a warning, never a block. At most
 * 40 lines go in one request. The load carries a replay key: a reply lost on the Wi-Fi never loads twice. After a
 * load the batch opens, to start the cycle.
 */
export function LoadView() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: me } = useMe();
  const refresh = useAgeingRefresh();
  const params = useLocalSearchParams<{ trolley?: string }>();
  const asked = typeof params.trolley === "string" && params.trolley ? params.trolley : null;
  const trolleys = useQuery(trpc.ageing.trolleys.list.queryOptions({}));
  const [trolleyId, setTrolleyId] = useState<string | null>(asked);
  const [source, setSource] = useState<Source>("press");
  const [picks, setPicks] = useState<PickState>({});
  const [bundleIds, setBundleIds] = useState<Record<string, true>>({});
  const [bundleSearch, setBundleSearch] = useState("");
  const [tried, setTried] = useState(false);
  const load = useMutation(trpc.ageing.batches.load.mutationOptions());
  const write = useKeyedWrite(refresh);

  const free = useMemo(() => (trolleys.data?.items ?? []).filter((r) => r.status === "active" && (r.openBatchId === null || r.openBatchStatus === "loading")), [trolleys.data]);
  const trolley = free.find((r) => r.id === trolleyId) ?? null;
  // A trolley asked for that is not free any more is dropped, so the picker says so.
  useEffect(() => {
    if (trolleys.data && trolleyId && !free.some((r) => r.id === trolleyId)) setTrolleyId(null);
  }, [trolleys.data, free, trolleyId]);
  useEffect(() => {
    if (trolleyId === null && free.length === 1 && !asked) setTrolleyId(free[0]!.id);
  }, [free, trolleyId, asked]);

  const lines = useQuery({ ...trpc.ageing.batches.availableLines.queryOptions({ limit: 100 }), enabled: can(me, "ageing.load") });
  const search = useDebounced(bundleSearch.trim());
  const bundles = useQuery({ ...trpc.ageing.batches.availableBundles.queryOptions({ limit: 100, ...(search ? { search } : {}) }), enabled: source === "bundles" && can(me, "ageing.load") });

  const lineItems = lines.data?.items ?? [];
  const pickedBundles = (bundles.data?.items ?? []).filter((b) => bundleIds[b.bundleId]);
  const totals = loadTotals(lineItems, picks, pickedBundles.map((b) => ({ pcs: b.pcs, weightG: b.weightG })));
  const capacity = ageingCapacity(totals.kgG, trolley?.capacityG ?? null);
  const tooMany = totals.lines > AGEING_LOAD_MAX_ROWS;
  const ready = canLoad(totals, trolleyId) && !tooMany;

  const submit = async () => {
    setTried(true);
    if (!ready || write.pending || !trolleyId) return;
    const body = {
      trolleyId,
      ...(trolley?.openBatchId ? { batchId: trolley.openBatchId } : {}),
      rows: pressRowsOf(lineItems, picks),
      bundles: pickedBundles.map((b) => ({ bundleId: b.bundleId })),
      manual: [] as never[],
    };
    const res = await write.run(body, (clientMutationId) => load.mutateAsync({ ...body, clientMutationId }));
    if (!res) return;
    announce(t("ageing.load.loaded", { number: res.number }));
    await refresh();
    router.replace({ pathname: "/more/ageing/[id]", params: { id: res.id } });
  };

  const title = <Stack.Screen options={{ title: t("ageing.load.title") }} />;
  if (!can(me, "ageing.load")) {
    return (
      <Screen>
        {title}
        <EmptyState title={t("ageing.noAccess")} body={t("ageing.noAccessLoad")} />
      </Screen>
    );
  }
  if (trolleys.isError && !trolleys.data) {
    return (
      <Screen>
        {title}
        <ErrorBlock error={trolleys.error} onRetry={() => void trolleys.refetch()} retrying={trolleys.isRefetching} />
      </Screen>
    );
  }
  if (!trolleys.data) {
    return (
      <Screen>
        {title}
        <LoadingBlock />
      </Screen>
    );
  }

  const sourceOptions = [
    { value: "press" as const, label: t("ageing.source.press") },
    { value: "bundles" as const, label: t("ageing.load.bundles") },
  ];
  return (
    <View className="flex-1 bg-canvas">
      {title}
      <Screen>
        <PageHeader title={t("ageing.load.title")} subtitle={t("ageing.load.subtitle")} />
        <TrolleyPicker trolleys={free} value={trolleyId} onChange={setTrolleyId} error={tried && !trolleyId ? t("ageing.load.pickTrolley") : null} />
        <SegmentedControl label={t("ageing.load.source")} options={sourceOptions} value={source} onChange={setSource} />
        {source === "press" ? <PressLines query={lines} items={lineItems} picks={picks} onPicks={setPicks} /> : <Bundles query={bundles} search={bundleSearch} onSearch={setBundleSearch} picked={bundleIds} onPicked={setBundleIds} />}
        {tooMany ? <Note tone="red">{t("ageing.refusal.tooManyRows", { n: AGEING_LOAD_MAX_ROWS })}</Note> : null}
        {tried && totals.lines === 0 ? <Note tone="red">{t("ageing.refusal.noRows")}</Note> : null}
        <View className="h-28" />
      </Screen>
      <View style={{ paddingBottom: Math.max(insets.bottom, 12) }} className="gap-2 border-t border-hairline bg-canvas px-4 pt-3">
        <ErrorLine error={write.error} />
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <Text accessibilityLiveRegion="polite" className="font-sans-semibold text-sm text-ink">
            {t("ageing.load.summary", { lines: totals.lines, pcs: totals.pcs, kg: kgText(totals.kgG) })}
          </Text>
          {trolley && totals.lines > 0 && capacity !== "ok" ? <Chip tone={capacityTone(capacity)} label={t(`ageing.capacity.${capacity}`)} /> : null}
        </View>
        <Button size="lg" label={t("ageing.load.submit")} loading={write.pending} disabled={!ready && tried} onPress={() => void submit()} />
      </View>
    </View>
  );
}

function TrolleyPicker({
  trolleys,
  value,
  onChange,
  error,
}: {
  trolleys: readonly { id: string; code: string; capacityG: number | null; openBatchNumber: string | null }[];
  value: string | null;
  onChange: (id: string) => void;
  error: string | null;
}) {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  if (trolleys.length === 0) return <EmptyState title={t("ageing.load.noFreeTrolley")} body={t("ageing.load.noFreeTrolleyBody")} />;
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {t("ageing.field.trolley")}
      </Text>
      <View accessibilityRole="radiogroup" className="gap-2">
        {trolleys.map((r) => {
          const selected = r.id === value;
          return (
            <ListRow
              key={r.id}
              title={r.code}
              subtitle={r.openBatchNumber ? t("ageing.load.addTo", { number: r.openBatchNumber }) : r.capacityG ? t("ageing.floor.capacity", { kg: kgText(r.capacityG) }) : t("ageing.floor.free")}
              className={cn(selected && "border-primary")}
              radioChecked={selected}
              trailing={selected ? <Feather name="check-circle" size={22} color={ink} importantForAccessibility="no" /> : undefined}
              onPress={() => onChange(r.id)}
            />
          );
        })}
      </View>
      {error ? <Text accessibilityLiveRegion="polite" className="font-sans-medium text-sm text-destructive">{error}</Text> : null}
    </View>
  );
}

/** A tick box row: the line or bundle goes on the trolley. */
function CheckCard({ checked, label, children, onToggle }: { checked: boolean; label: string; children: ReactNode; onToggle: () => void }) {
  const ink = useThemeColor("foreground");
  return (
    <PressableScale
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onToggle}
      className={cn("min-h-14 flex-row items-start gap-3 rounded-card border bg-surface p-3", checked ? "border-primary" : "border-hairline")}
    >
      <View className={cn("mt-0.5 h-6 w-6 items-center justify-center rounded-input border", checked ? "border-primary bg-primary" : "border-control")}>
        {checked ? <Feather name="check" size={16} color={ink} importantForAccessibility="no" /> : null}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">{children}</View>
    </PressableScale>
  );
}

function PressLines({
  query,
  items,
  picks,
  onPicks,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: unknown; refetch: () => unknown; isRefetching: boolean };
  items: readonly AvailableLine[];
  picks: PickState;
  onPicks: (next: PickState) => void;
}) {
  const { t } = useT();
  if (query.isError && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />;
  if (query.isPending) return <LoadingBlock />;
  if (items.length === 0) return <EmptyState title={t("ageing.empty.noLines")} />;
  return (
    <View accessibilityLabel={t("ageing.load.linesLabel")} className="gap-2">
      {items.map((line) => {
        const checked = picks[line.pressRunLineId] !== undefined;
        const pick = pickOf(picks[line.pressRunLineId], line);
        const name = `${line.pressRunNumber} ${line.sectionLabel}`;
        const toggle = () => {
          const next = { ...picks };
          if (checked) delete next[line.pressRunLineId];
          else next[line.pressRunLineId] = String(line.pcsLeft);
          onPicks(next);
        };
        return (
          <View key={line.pressRunLineId} className="gap-2">
            <CheckCard checked={checked} label={name} onToggle={toggle}>
              <Text className="font-sans-semibold text-base text-ink">{`${line.pressRunNumber} ${line.sectionLabel}${line.dieInstanceCode ? `, ${line.dieInstanceCode}` : ""}`}</Text>
              <Text className="font-sans text-[13px] leading-5 text-ink-muted">
                {[
                  t("ageing.load.lineLength", { mm: line.lengthMm }),
                  t("ageing.load.lineLeft", { pcs: line.pcsLeft, kg: kgText(line.kgLeftG) }),
                  line.castCode ? t("ageing.load.lineCast", { cast: line.castCode }) : null,
                  [line.alloy, line.temper].filter(Boolean).join(" "),
                  line.salesOrderNumber ? `${line.salesOrderNumber}${line.customerName ? `, ${line.customerName}` : ""}` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            </CheckCard>
            {checked ? (
              <NumberInput
                integer
                label={t("ageing.load.piecesOf", { name })}
                unit={t("units.pcs")}
                value={picks[line.pressRunLineId] ?? ""}
                onChangeText={(v) => onPicks({ ...picks, [line.pressRunLineId]: v })}
                error={pick.error === "over" ? t("ageing.refusal.overLine", { n: line.pcsLeft }) : pick.error === "invalid" ? t("ageing.load.piecesInvalid") : null}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Bundles({
  query,
  search,
  onSearch,
  picked,
  onPicked,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: { items: AvailableBundle[] } | undefined; refetch: () => unknown; isRefetching: boolean };
  search: string;
  onSearch: (v: string) => void;
  picked: Record<string, true>;
  onPicked: (next: Record<string, true>) => void;
}) {
  const { t } = useT();
  const items = query.data?.items ?? [];
  return (
    <View className="gap-3">
      <Field label={t("ageing.load.bundleSearch")} hint={t("ageing.load.bundlesHint")} value={search} onChangeText={onSearch} maxLength={40} autoCapitalize="characters" autoCorrect={false} mono />
      {query.isError && !query.data ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
      ) : query.isPending ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <EmptyState title={t("ageing.load.noBundles")} />
      ) : (
        items.map((b) => {
          const checked = Boolean(picked[b.bundleId]);
          return (
            <CheckCard
              key={b.bundleId}
              checked={checked}
              label={b.serial}
              onToggle={() => {
                const next = { ...picked };
                if (checked) delete next[b.bundleId];
                else next[b.bundleId] = true;
                onPicked(next);
              }}
            >
              <Text className="font-mono-semibold text-base text-ink">{b.serial}</Text>
              <Text className="font-sans text-[13px] leading-5 text-ink-muted">
                {[b.sectionLabel, t("ageing.load.lineLength", { mm: b.lengthMm }), `${b.pcs} ${t("units.pcs")}, ${kgText(b.weightG)} ${t("units.kg")}`, b.castCode, [b.alloy, b.temper].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
              </Text>
            </CheckCard>
          );
        })
      )}
    </View>
  );
}
