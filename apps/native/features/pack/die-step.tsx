import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { NumberInput } from "@/components/ui/number-input";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Sheet } from "@/components/ui/sheet";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useThemeColor } from "@/lib/theme";
import { trpc } from "@/utils/trpc";

import { dieCode, hasRange, kgText, type PickedDie } from "./pack-form";
import type { LengthFields, PackSource, YardOption } from "./pack-math";
import { SourcePanel, type SourceGate } from "./source-panel";
import { recentDieIds } from "./recent-dies";

type DieRow = { id: string; series: string; sectionCode: string; name: string | null; weightMinG: number; weightMaxG: number };

const toPicked = (d: DieRow): PickedDie => ({ id: d.id, label: dieCode(d), weightMinG: d.weightMinG, weightMaxG: d.weightMaxG });

export function DieRangeText({ die }: { die: { weightMinG: number; weightMaxG: number } }) {
  const { t } = useT();
  if (!hasRange(die)) return <Text className="font-sans text-sm text-ink-muted">{t("status.range.noRange")}</Text>;
  return (
    <Text className="font-mono text-sm text-ink-muted">
      {t("pack.new.dieRange", { min: kgText(die.weightMinG), max: kgText(die.weightMaxG) })}
    </Text>
  );
}

function DieRowButton({ die, onPick }: { die: DieRow; onPick: (d: PickedDie) => void }) {
  const { t } = useT();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${t("pack.new.chooseDie")}, ${dieCode(die)}`}
      onPress={() => onPick(toPicked(die))}
      className="min-h-14 justify-center gap-0.5 rounded-card border border-hairline bg-surface px-4 py-3"
    >
      <Text className="font-sans-semibold text-base text-ink">{dieCode(die)}</Text>
      {die.name?.trim() ? <Text className="font-sans text-sm text-ink-muted">{die.name}</Text> : null}
      <DieRangeText die={die} />
    </PressableScale>
  );
}

function DieSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (d: PickedDie) => void }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearch(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);

  // "Recent" comes from the newest sessions, not the newest dies (die.list is capped and ordered by creation).
  const sessions = useQuery({ ...trpc.bundle.listGroups.queryOptions({ limit: 30 }), enabled: visible });
  const recentIds = recentDieIds(sessions.data?.items ?? [], 5);
  const recent = useQueries({
    queries: recentIds.map((id) => ({ ...trpc.die.get.queryOptions({ id }), enabled: visible })),
  });
  const recentDies = recent.map((r) => r.data as DieRow | undefined).filter((d): d is DieRow => !!d);

  const dies = useQuery({ ...trpc.die.list.queryOptions({ search: search || undefined, limit: 30 }), enabled: visible });
  const rows = (dies.data?.items ?? []) as DieRow[];

  return (
    <Sheet visible={visible} onClose={onClose} title={t("native.pack.dieSheetTitle")}>
      <Field label={t("pack.new.dieSearch")} value={text} onChangeText={setText} autoCapitalize="characters" autoCorrect={false} returnKeyType="search" />
      {!search && recentDies.length > 0 ? (
        <View className="gap-2">
          <Text accessibilityRole="header" className="font-sans-semibold text-sm text-ink-muted">
            {t("pack.new.recentDies")}
          </Text>
          {recentDies.map((d) => (
            <DieRowButton key={d.id} die={d} onPick={onPick} />
          ))}
        </View>
      ) : null}
      {dies.isPending ? <LoadingBlock /> : null}
      {dies.isError ? <ErrorBlock error={dies.error} onRetry={() => void dies.refetch()} retrying={dies.isRefetching} /> : null}
      {dies.data && rows.length === 0 ? <Text className="font-sans text-[15px] text-ink-muted">{t("pack.new.noDies")}</Text> : null}
      <View className="gap-2">
        {rows.map((d) => (
          <DieRowButton key={d.id} die={d} onPick={onPick} />
        ))}
      </View>
    </Sheet>
  );
}

export type DieStepProps = {
  die: PickedDie | null;
  onPickDie: (die: PickedDie) => void;
  unit: "mm" | "inch";
  lengthFields: LengthFields;
  onLengthFields: (next: LengthFields) => void;
  lengthError: boolean;
  po: string;
  onPo: (po: string) => void;
  yards: YardOption[];
  locationId: string | null;
  onLocation: (id: string) => void;
  yardError: boolean;
  canNext: boolean;
  onNext: () => void;
  /** What the bundles are for (D20): an order line or Plant stock, the die copy, the cast, the logo. */
  source: PackSource;
  onSource: (next: PackSource) => void;
  gate: SourceGate;
  sourceError: boolean;
};

/** Step 1, Source: which die, what the bundles are for, the session's cut length and PO, and the yard when the company has yards. */
export function DieStep(p: DieStepProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ink = useThemeColor("foreground");
  const lengthMessage = p.lengthError ? t("native.pack.cutLengthError") : null;

  return (
    <View className="gap-4">
      {p.die ? (
        <View className="gap-1 rounded-card border border-hairline bg-surface p-4">
          <Text className="font-display-bold text-xl text-ink">{p.die.label}</Text>
          <DieRangeText die={p.die} />
          <Button variant="secondary" label={t("pack.new.changeDie")} onPress={() => setOpen(true)} className="mt-2 self-start" />
        </View>
      ) : (
        <Button size="lg" label={t("native.pack.pickDie")} onPress={() => setOpen(true)} />
      )}

      {p.unit === "mm" ? (
        <NumberInput
          label={t("native.pack.cutLengthMm")}
          unit={t("units.mm")}
          integer
          value={p.lengthFields.mm}
          onChangeText={(mm) => p.onLengthFields({ ...p.lengthFields, mm })}
          error={lengthMessage}
        />
      ) : (
        <View className="flex-row gap-3">
          <NumberInput
            className="flex-1"
            label={`${t("pack.new.cutLength")}, ${t("pack.new.cutLengthFeet")}`}
            unit={t("units.ft")}
            integer
            value={p.lengthFields.feet}
            onChangeText={(feet) => p.onLengthFields({ ...p.lengthFields, feet })}
            error={lengthMessage}
          />
          <NumberInput
            className="flex-1"
            label={t("pack.new.cutLengthInches")}
            unit={t("units.inch")}
            value={p.lengthFields.inches}
            onChangeText={(inches) => p.onLengthFields({ ...p.lengthFields, inches })}
          />
        </View>
      )}

      {p.die ? <SourcePanel choice={p.source} onChange={p.onSource} gate={p.gate} showErrors={p.sourceError} /> : null}

      <Field label={t("pack.new.po")} value={p.po} onChangeText={p.onPo} autoCapitalize="characters" autoCorrect={false} hint={t("pack.new.defaultsHint")} />

      {p.yards.length > 0 ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={t("native.pack.yard")} className="gap-2">
          <Text className="font-sans-medium text-sm text-ink">{t("native.pack.yard")}</Text>
          {p.yards.map((y) => {
            const selected = y.id === p.locationId;
            return (
              <ListRow
                key={y.id}
                title={y.code}
                subtitle={y.name}
                className={cn(selected && "border-primary")}
                trailing={selected ? <Feather name="check-circle" size={22} color={ink} importantForAccessibility="no" /> : undefined}
                accessibilityLabel={`${y.code}, ${y.name}`}
                onPress={() => p.onLocation(y.id)}
              />
            );
          })}
          <Text className={cn("font-sans text-sm", p.yardError ? "text-destructive" : "text-ink-muted")}>
            {p.yardError ? t("native.pack.yardRequired") : t("native.pack.yardHint")}
          </Text>
        </View>
      ) : null}

      {p.sourceError && p.gate.blockers.length > 0 ? <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-destructive">{t("pack.source.cannotContinue")}</Text> : null}
      <Button size="lg" label={t("common.next")} disabled={!p.canNext} onPress={p.onNext} />

      <DieSheet
        visible={open}
        onClose={() => setOpen(false)}
        onPick={(d) => {
          p.onPickDie(d);
          setOpen(false);
        }}
      />
    </View>
  );
}
