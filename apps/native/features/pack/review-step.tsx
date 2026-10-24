import { formatKg, formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";

import { VerdictChip } from "./bundles-step";
import { bundleReadout, outOfRangeCount, type PickedDie } from "./pack-form";
import { draftTotals, type DraftBundle, type YardOption } from "./pack-math";

export type SaveProblem = {
  /** "unsure": it may have saved, so Save stays hidden until a check says it did not. */
  kind: "unsure" | "failed";
  title: string;
  body: string;
};

export type ReviewStepProps = {
  die: PickedDie;
  defaultLengthMm: number;
  formatLength: (mm: number) => string;
  po: string;
  yard: YardOption | null;
  bundles: DraftBundle[];
  saving: boolean;
  problem: SaveProblem | null;
  /** Result line of the last "did it save" check. */
  checkNote: string | null;
  checking: boolean;
  onSave: () => void;
  onCheckAgain: () => void;
  onBack: () => void;
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="font-sans text-[15px] text-ink-muted">{label}</Text>
      <Text className="min-w-0 shrink font-mono-semibold text-base text-ink">{value}</Text>
    </View>
  );
}

/** Step 3: read it over, then save. After an "unsure" save, Save waits for the check. */
export function ReviewStep(p: ReviewStepProps) {
  const { t } = useT();
  const totals = draftTotals(p.bundles);
  const outside = outOfRangeCount(p.bundles, p.defaultLengthMm, p.die);
  const blocked = p.problem?.kind === "unsure";

  return (
    <View className="gap-4">
      <View className="gap-2 rounded-card border border-hairline bg-surface p-4">
        <Text className="font-display-bold text-xl text-ink">{p.die.label}</Text>
        <Fact label={t("pack.new.cutLength")} value={p.formatLength(p.defaultLengthMm)} />
        {p.po.trim() ? <Fact label={t("pack.new.po")} value={p.po.trim()} /> : null}
        {p.yard ? <Fact label={t("native.pack.yard")} value={p.yard.code} /> : null}
        <Fact label={t("pack.new.totalBundles")} value={String(totals.bundles)} />
        <Fact label={t("pack.new.totalPieces")} value={String(totals.pieces)} />
        <Fact label={t("pack.new.totalKg")} value={formatKgTotal(gToKg(totals.weightG))} />
      </View>
      {outside > 0 ? <Text className="font-sans text-sm text-tone-amber-ink">{t("native.pack.outOfRange", { count: outside })}</Text> : null}

      <View className="gap-2">
        {p.bundles.map((b, i) => {
          const r = bundleReadout(b, p.defaultLengthMm, p.die);
          return (
            <View key={b.key} className="flex-row items-center justify-between gap-3 rounded-card border border-hairline bg-surface px-4 py-3">
              <View className="min-w-0 flex-1">
                <Text className="font-sans-semibold text-base text-ink">{t("pack.new.bundleNumber", { n: i + 1 })}</Text>
                <Text className="font-mono text-sm text-ink-muted">{t("native.pack.bundleLine", { kg: formatKg(gToKg(b.weightG)), pieces: b.pieces })}</Text>
              </View>
              <VerdictChip readout={r} />
            </View>
          );
        })}
      </View>

      {p.problem ? (
        <View accessibilityLiveRegion="polite" className="gap-1 rounded-card bg-tone-red-tint p-4">
          <Text className="font-sans-semibold text-base text-tone-red-ink">{p.problem.title}</Text>
          {p.problem.body ? <Text className="font-sans text-[15px] leading-6 text-tone-red-ink">{p.problem.body}</Text> : null}
          {p.checkNote ? <Text className="mt-1 font-sans-medium text-[15px] text-tone-red-ink">{p.checkNote}</Text> : null}
        </View>
      ) : null}

      {blocked ? (
        <Button size="lg" label={t("native.pack.checkAgain")} loading={p.checking} loadingLabel={t("native.pack.checking")} onPress={p.onCheckAgain} />
      ) : (
        <Button size="lg" label={t("pack.new.saveOnly")} loading={p.saving} loadingLabel={t("common.saving")} onPress={p.onSave} />
      )}
      <Button variant="ghost" label={t("native.pack.editBundles")} disabled={p.saving || p.checking} onPress={p.onBack} />
    </View>
  );
}
