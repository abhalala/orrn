import Feather from "@expo/vector-icons/Feather";
import { formatKg, formatKgTotal, gToKg, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useRef, useState } from "react";
import { Alert, Text, View, type TextInput as InputHandle } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { announce } from "@/lib/a11y";
import { useThemeColor } from "@/lib/theme";

import {
  bundleReadout,
  newBundleKey,
  outOfRangeCount,
  parseBundleEntry,
  VERDICT_KEY,
  VERDICT_TONE,
  type PickedDie,
  type TypedBundle,
} from "./pack-form";
import { draftTotals, lengthFieldsToMm, lengthToFields, parsePieces, parseWeightG, type DraftBundle, type LengthFields } from "./pack-math";

const BLANK_LENGTH: LengthFields = { mm: "", feet: "", inches: "" };
const BLANK: TypedBundle = { weight: "", pieces: "", override: false, lengthFields: BLANK_LENGTH, po: "" };

export function VerdictChip({ readout }: { readout: ReturnType<typeof bundleReadout> }) {
  const { t } = useT();
  if (!readout?.verdict) return null;
  return <Chip tone={VERDICT_TONE[readout.verdict]} label={t(VERDICT_KEY[readout.verdict])} />;
}

export type BundlesStepProps = {
  die: PickedDie;
  unit: LengthUnit;
  defaultLengthMm: number;
  formatLength: (mm: number) => string;
  bundles: DraftBundle[];
  onBundles: (next: DraftBundle[]) => void;
  onBack: () => void;
  onNext: () => void;
};

/** Step 2: type each bundle; the kg/12ft readout and range verdict update as you type. */
export function BundlesStep(p: BundlesStepProps) {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  const [typed, setTyped] = useState<TypedBundle>(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const weightRef = useRef<InputHandle>(null);

  const parsed = parseBundleEntry(p.unit, typed);
  const errors = parsed.ok ? {} : parsed.errors;
  const weightG = parseWeightG(typed.weight);
  const pieces = parsePieces(typed.pieces);
  const ownLength = typed.override ? lengthFieldsToMm(p.unit, typed.lengthFields) : null;
  const readout = weightG !== null && pieces !== null ? bundleReadout({ weightG, pieces, lengthMm: ownLength }, p.defaultLengthMm, p.die) : null;
  const totals = draftTotals(p.bundles);
  const outside = outOfRangeCount(p.bundles, p.defaultLengthMm, p.die);

  const reset = (keepPieces: string) => {
    setTyped({ ...BLANK, pieces: keepPieces });
    setEditing(null);
    setTried(false);
    weightRef.current?.focus();
  };

  const save = () => {
    setTried(true);
    if (!parsed.ok) return;
    const next: DraftBundle = {
      key: editing ?? newBundleKey(),
      weightG: parsed.weightG,
      pieces: parsed.pieces,
      lengthMm: parsed.lengthMm,
      po: parsed.po,
    };
    p.onBundles(editing ? p.bundles.map((b) => (b.key === editing ? next : b)) : [...p.bundles, next]);
    announce(t("native.pack.bundleLine", { kg: formatKg(gToKg(parsed.weightG)), pieces: parsed.pieces }));
    reset(typed.pieces);
  };

  const edit = (b: DraftBundle) => {
    const own = b.lengthMm !== null || !!b.po;
    setEditing(b.key);
    setTried(false);
    setTyped({
      weight: String(gToKg(b.weightG)),
      pieces: String(b.pieces),
      override: own,
      lengthFields: b.lengthMm !== null ? lengthToFields(b.lengthMm, p.unit) : BLANK_LENGTH,
      po: b.po ?? "",
    });
    weightRef.current?.focus();
  };

  const remove = (b: DraftBundle) => {
    Alert.alert(t("native.pack.removeTitle"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("pack.new.removeBundle"),
        style: "destructive",
        onPress: () => {
          p.onBundles(p.bundles.filter((x) => x.key !== b.key));
          if (editing === b.key) reset(typed.pieces);
        },
      },
    ]);
  };

  const setOwn = (lengthFields: LengthFields) => setTyped((v) => ({ ...v, lengthFields }));

  return (
    <View className="gap-4">
      <View className="gap-1 rounded-card border border-hairline bg-surface p-4">
        <Text className="font-display-bold text-lg text-ink">{p.die.label}</Text>
        <Text className="font-sans text-sm text-ink-muted">{p.formatLength(p.defaultLengthMm)}</Text>
      </View>

      <NumberInput
        ref={weightRef}
        label={t("pack.new.weight")}
        unit={t("units.kg")}
        value={typed.weight}
        onChangeText={(weight) => setTyped((v) => ({ ...v, weight }))}
        error={tried && errors.weight ? t("native.pack.weightError") : null}
      />
      <NumberInput
        label={t("pack.new.pieces")}
        integer
        value={typed.pieces}
        onChangeText={(pcs) => setTyped((v) => ({ ...v, pieces: pcs }))}
        error={tried && errors.pieces ? t("native.pack.piecesError") : null}
      />

      <Button
        variant="ghost"
        label={t("pack.new.differentLengthPo")}
        icon={<Feather name={typed.override ? "chevron-up" : "chevron-down"} size={18} color={ink} importantForAccessibility="no" />}
        onPress={() => setTyped((v) => ({ ...v, override: !v.override }))}
        className="self-start"
      />
      {typed.override ? (
        <View className="gap-3">
          {p.unit === "mm" ? (
            <NumberInput
              label={t("native.pack.overrideLength")}
              unit={t("units.mm")}
              integer
              value={typed.lengthFields.mm}
              onChangeText={(mm) => setOwn({ ...typed.lengthFields, mm })}
              error={tried && errors.length ? t("native.pack.cutLengthError") : null}
              hint={t("native.pack.overrideLengthHint")}
            />
          ) : (
            <View className="flex-row gap-3">
              <NumberInput
                className="flex-1"
                label={`${t("native.pack.overrideLength")}, ${t("pack.new.cutLengthFeet")}`}
                unit={t("units.ft")}
                integer
                value={typed.lengthFields.feet}
                onChangeText={(feet) => setOwn({ ...typed.lengthFields, feet })}
                error={tried && errors.length ? t("native.pack.cutLengthError") : null}
              />
              <NumberInput
                className="flex-1"
                label={t("pack.new.cutLengthInches")}
                unit={t("units.inch")}
                value={typed.lengthFields.inches}
                onChangeText={(inches) => setOwn({ ...typed.lengthFields, inches })}
              />
            </View>
          )}
          <Field label={t("native.pack.overridePo")} value={typed.po} onChangeText={(po) => setTyped((v) => ({ ...v, po }))} autoCapitalize="characters" autoCorrect={false} />
        </View>
      ) : null}

      <View accessibilityLiveRegion="polite" className="min-h-12 flex-row flex-wrap items-center gap-3 rounded-card bg-surface-sunken px-4 py-3">
        {readout ? (
          <>
            <Text className="font-mono-semibold text-xl text-ink">{t("native.pack.readout", { value: readout.text })}</Text>
            <VerdictChip readout={readout} />
          </>
        ) : (
          <Text className="font-sans text-sm text-ink-muted">{t("native.pack.readoutEmpty")}</Text>
        )}
      </View>

      <Button size="lg" label={editing ? t("native.pack.updateBundle") : t("pack.new.saveBundle")} onPress={save} />
      {editing ? <Button variant="ghost" label={t("native.pack.cancelEdit")} onPress={() => reset(typed.pieces)} /> : null}

      <View className="gap-2">
        <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
          {t("native.pack.bundlesTitle")}
        </Text>
        {p.bundles.length === 0 ? <Text className="font-sans text-[15px] text-ink-muted">{t("native.pack.noBundles")}</Text> : null}
        {p.bundles.map((b, i) => {
          const r = bundleReadout(b, p.defaultLengthMm, p.die);
          return (
            <View key={b.key} className="gap-2 rounded-card border border-hairline bg-surface p-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="font-sans-semibold text-base text-ink">{t("pack.new.bundleNumber", { n: i + 1 })}</Text>
                <VerdictChip readout={r} />
              </View>
              <Text className="font-mono text-sm text-ink">
                {b.lengthMm !== null || b.po
                  ? t("native.pack.bundleLineOwn", {
                      kg: formatKg(gToKg(b.weightG)),
                      pieces: b.pieces,
                      length: p.formatLength(b.lengthMm ?? p.defaultLengthMm),
                      po: b.po ?? "-",
                    })
                  : t("native.pack.bundleLine", { kg: formatKg(gToKg(b.weightG)), pieces: b.pieces })}
              </Text>
              {r ? <Text className="font-mono text-sm text-ink-muted">{t("native.pack.readout", { value: r.text })}</Text> : null}
              <View className="flex-row gap-2">
                <Button variant="secondary" label={t("pack.new.editBundle")} onPress={() => edit(b)} className="flex-1" />
                <Button variant="secondary" label={t("pack.new.removeBundle")} onPress={() => remove(b)} className="flex-1" />
              </View>
            </View>
          );
        })}
      </View>

      <View className="flex-row items-baseline justify-between gap-3 rounded-card bg-surface-sunken px-4 py-3">
        <Text className="font-sans-medium text-[15px] text-ink">
          {t("units.bundles", { count: totals.bundles })}, {t("units.pieces", { count: totals.pieces })}
        </Text>
        <Text className="font-mono-semibold text-lg text-ink">
          {formatKgTotal(gToKg(totals.weightG))} {t("units.kg")}
        </Text>
      </View>
      {outside > 0 ? <Text className="font-sans text-sm text-tone-amber-ink">{t("native.pack.outOfRange", { count: outside })}</Text> : null}

      <View className="gap-2">
        <Button size="lg" label={t("native.pack.review")} disabled={p.bundles.length === 0} onPress={p.onNext} />
        <Button variant="ghost" label={t("common.back")} onPress={p.onBack} />
      </View>
    </View>
  );
}
