import Feather from "@expo/vector-icons/Feather";
import { formatKg, formatKgTotal, gToKg, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useEffect, useRef, useState } from "react";
import { Alert, Text, View, type TextInput as InputHandle } from "react-native";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Field } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { announce } from "@/lib/a11y";
import { useThemeColor } from "@/lib/theme";

import { positionKey } from "./line-preview";
import { cardBundle, asksReason, type CardErrors } from "./pack-card";
import { newBundleKey, type PickedDie, type TypedBundle } from "./pack-form";
import { draftTotals, lengthFieldsToMm, lengthToFields, parsePieces, parseWeightG, type DraftBundle, type DraftReject, type LengthFields } from "./pack-math";
import { RejectsPanel } from "./rejects-panel";
import { gramsToFieldText, gramsToKgText, type ScaleView } from "./scale-view";
import { LiveReadout, VerdictChip, DriftChip } from "./verdict-chip";
import { useLinePreview, useLinesPreview, useScale } from "./use-pack-server";

const BLANK_LENGTH: LengthFields = { mm: "", feet: "", inches: "" };
const BLANK: TypedBundle = { weight: "", pieces: "", override: false, lengthFields: BLANK_LENGTH, po: "" };

export type BundlesStepProps = {
  die: PickedDie;
  /** The die copy chosen on the Source step; its band judges the weight (D15). */
  dieInstanceId?: string;
  unit: LengthUnit;
  defaultLengthMm: number;
  formatLength: (mm: number) => string;
  bundles: DraftBundle[];
  onBundles: (next: DraftBundle[]) => void;
  rejects: DraftReject[];
  onRejects: (next: DraftReject[]) => void;
  onBack: () => void;
  onNext: () => void;
};

function ScaleLine({ view }: { view: ScaleView }) {
  const { t } = useT();
  if (view.state === "off") return null;
  if (view.state === "stable") {
    return <Chip tone="green" label={`${t("pack.scale.stable")} ${gramsToKgText(view.grams)} ${t("units.kg")}${view.simulated ? ` ${t("pack.scale.simulated")}` : ""}`} />;
  }
  if (view.state === "waiting") return <Chip tone="amber" label={t("pack.scale.waiting")} />;
  return <Chip tone="amber" label={t("native.pack.scaleSilent")} />;
}

/**
 * Step 2: type each bundle. kg per 12 ft, the band word and the drift are the server's (`bundle.previewLine`),
 * never worked out on the phone. When the plant has a scale, a steady weight fills the field; typing over it
 * asks why (D12). Pieces taken out of the pile go in the rejects panel.
 */
export function BundlesStep(p: BundlesStepProps) {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  const [typed, setTyped] = useState<TypedBundle>(BLANK);
  const [editing, setEditing] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [errors, setErrors] = useState<CardErrors>({});
  const weightRef = useRef<InputHandle>(null);

  // The scale: the steady weight fills the field; `filledFrom` is the grams it was filled with.
  const scale = useScale(true);
  const [filledFrom, setFilledFrom] = useState<number | null>(null);
  const [armed, setArmed] = useState(true);
  const [reason, setReason] = useState("");

  const stable = scale.view.state === "stable" ? scale.view.grams : null;
  const latest = useRef({ weight: typed.weight, filledFrom });
  latest.current = { weight: typed.weight, filledFrom };
  // A steady weight fills an empty weight field (or one still holding the last scale fill). After a bundle is
  // saved it waits for the scale to settle on something new, so the same bundle is never filled twice.
  useEffect(() => {
    if (stable === null) {
      setArmed(true);
      return;
    }
    if (editing !== null || !armed) return;
    const { weight: w, filledFrom: f } = latest.current;
    const holdsScaleFill = f !== null && w === gramsToFieldText(f);
    if (w.trim() !== "" && !holdsScaleFill) return;
    setTyped((v) => ({ ...v, weight: gramsToFieldText(stable) }));
    setFilledFrom(stable);
  }, [stable, armed, editing]);

  const weightG = parseWeightG(typed.weight);
  const pieces = parsePieces(typed.pieces);
  const ownLength = typed.override ? lengthFieldsToMm(p.unit, typed.lengthFields) : null;
  const live = useLinePreview({ dieId: p.die.id, dieInstanceId: p.dieInstanceId, lengthMm: ownLength ?? p.defaultLengthMm, weightG, pieces });
  const saved = useLinesPreview(
    p.die.id,
    p.dieInstanceId,
    p.bundles.map((b) => ({ lengthMm: b.lengthMm ?? p.defaultLengthMm, weightG: b.weightG, pcs: b.pieces })),
  );
  const totals = draftTotals(p.bundles);
  const outside = saved.verdicts.filter((v) => v.position === "below" || v.position === "above").length;
  const whyField = asksReason(scale.view, weightG, filledFrom);

  const reset = () => {
    setTyped(BLANK);
    setEditing(null);
    setTried(false);
    setErrors({});
    setFilledFrom(null);
    setReason("");
  };

  const save = () => {
    setTried(true);
    const res = cardBundle({ key: editing ?? newBundleKey(), unit: p.unit, typed, scale: scale.view, filledFromG: filledFrom, lastStableG: scale.lastStableG, reason });
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    const b = res.bundle;
    p.onBundles(editing ? p.bundles.map((x) => (x.key === editing ? b : x)) : [...p.bundles, b]);
    const word = live.verdict && positionKey(live.verdict.position) ? t(positionKey(live.verdict.position)!) : t("status.range.noRange");
    announce(`${t("native.pack.bundleLine", { kg: formatKg(gToKg(b.weightG)), pieces: b.pieces })}, ${word}`);
    // Keep the pieces for the next bundle (a stack is usually the same count); the bundle stays on the scale a moment.
    const keep = typed.pieces;
    reset();
    setTyped({ ...BLANK, pieces: keep });
    setArmed(false);
    weightRef.current?.focus();
  };

  const edit = (b: DraftBundle) => {
    const own = b.lengthMm !== null || !!b.po;
    setEditing(b.key);
    setTried(false);
    setErrors({});
    setTyped({
      weight: gramsToFieldText(b.weightG),
      pieces: String(b.pieces),
      override: own,
      lengthFields: b.lengthMm !== null ? lengthToFields(b.lengthMm, p.unit) : BLANK_LENGTH,
      po: b.po ?? "",
    });
    setFilledFrom(b.weightSource === "scale" ? (b.scaleReadingG ?? null) : null);
    setReason(b.weightOverrideReason ?? "");
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
          if (editing === b.key) reset();
        },
      },
    ]);
  };

  const setOwn = (lengthFields: LengthFields) => setTyped((v) => ({ ...v, lengthFields }));
  const typedCount = p.bundles.filter((b) => b.weightSource === "manual").length;

  return (
    <View className="gap-4">
      <View className="gap-1 rounded-card border border-hairline bg-surface p-4">
        <Text className="font-display-bold text-lg text-ink">{p.die.label}</Text>
        <Text className="font-sans text-sm text-ink-muted">{p.formatLength(p.defaultLengthMm)}</Text>
      </View>

      <ScaleLine view={scale.view} />

      <NumberInput
        ref={weightRef}
        label={t("pack.new.weight")}
        unit={t("units.kg")}
        value={typed.weight}
        onChangeText={(weight) => setTyped((v) => ({ ...v, weight }))}
        error={tried && errors.weight ? t("native.pack.weightError") : null}
      />
      {scale.view.state === "stable" && filledFrom !== scale.view.grams ? (
        <Button variant="secondary" label={t("pack.scale.useScale")} onPress={() => { setTyped((v) => ({ ...v, weight: gramsToFieldText((scale.view as { grams: number }).grams) })); setFilledFrom((scale.view as { grams: number }).grams); }} />
      ) : null}
      {whyField ? (
        <Field
          label={t("pack.scale.typedReason")}
          hint={t("pack.scale.typedReasonHint")}
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={500}
          error={tried && errors.reason ? t("pack.scale.reasonRequired") : null}
        />
      ) : null}
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
              <NumberInput className="flex-1" label={t("pack.new.cutLengthInches")} unit={t("units.inch")} value={typed.lengthFields.inches} onChangeText={(inches) => setOwn({ ...typed.lengthFields, inches })} />
            </View>
          )}
          <Field label={t("native.pack.overridePo")} value={typed.po} onChangeText={(po) => setTyped((v) => ({ ...v, po }))} autoCapitalize="characters" autoCorrect={false} />
        </View>
      ) : null}

      <LiveReadout verdict={live.verdict} loading={live.loading} />

      <Button size="lg" label={editing ? t("native.pack.updateBundle") : t("pack.new.saveBundle")} onPress={save} />
      {editing ? <Button variant="ghost" label={t("native.pack.cancelEdit")} onPress={reset} /> : null}

      <View className="gap-2">
        <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
          {t("native.pack.bundlesTitle")}
        </Text>
        {p.bundles.length === 0 ? <Text className="font-sans text-[15px] text-ink-muted">{t("native.pack.noBundles")}</Text> : null}
        {p.bundles.map((b, i) => {
          const v = saved.verdicts[i] ?? null;
          return (
            <View key={b.key} className="gap-2 rounded-card border border-hairline bg-surface p-3">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text className="font-sans-semibold text-base text-ink">{t("pack.new.bundleNumber", { n: i + 1 })}</Text>
                <View className="flex-row flex-wrap items-center gap-2">
                  <VerdictChip verdict={v} />
                  <DriftChip verdict={v} />
                </View>
              </View>
              <Text className="font-mono text-sm text-ink">
                {b.lengthMm !== null || b.po
                  ? t("native.pack.bundleLineOwn", { kg: formatKg(gToKg(b.weightG)), pieces: b.pieces, length: p.formatLength(b.lengthMm ?? p.defaultLengthMm), po: b.po ?? "-" })
                  : t("native.pack.bundleLine", { kg: formatKg(gToKg(b.weightG)), pieces: b.pieces })}
              </Text>
              {v?.kgPer12ftMilli != null ? <Text className="font-mono text-sm text-ink-muted">{t("native.pack.readout", { value: (v.kgPer12ftMilli / 1000).toFixed(3) })}</Text> : null}
              {b.weightSource === "manual" ? <Text className="font-sans text-sm text-ink-muted">{t("pack.scale.typed")}</Text> : null}
              <View className="flex-row gap-2">
                <Button variant="secondary" label={t("pack.new.editBundle")} onPress={() => edit(b)} className="flex-1" />
                <Button variant="secondary" label={t("pack.new.removeBundle")} onPress={() => remove(b)} className="flex-1" />
              </View>
            </View>
          );
        })}
      </View>

      <RejectsPanel rejects={p.rejects} onAdd={(r) => p.onRejects([...p.rejects, r])} onRemove={(i) => p.onRejects(p.rejects.filter((_, n) => n !== i))} />

      <View className="flex-row items-baseline justify-between gap-3 rounded-card bg-surface-sunken px-4 py-3">
        <Text className="font-sans-medium text-[15px] text-ink">
          {t("units.bundles", { count: totals.bundles })}, {t("units.pieces", { count: totals.pieces })}
        </Text>
        <Text className="font-mono-semibold text-lg text-ink">
          {formatKgTotal(gToKg(totals.weightG))} {t("units.kg")}
        </Text>
      </View>
      {outside > 0 ? <Text className="font-sans text-sm text-tone-amber-ink">{t("native.pack.outOfRange", { count: outside })}</Text> : null}
      {typedCount > 0 ? <Text className="font-sans text-sm text-ink-muted">{t("pack.scale.typedCount", { count: typedCount })}</Text> : null}

      <View className="gap-2">
        <Button size="lg" label={t("native.pack.review")} disabled={p.bundles.length === 0} onPress={p.onNext} />
        <Button variant="ghost" label={t("common.back")} onPress={p.onBack} />
      </View>
    </View>
  );
}
