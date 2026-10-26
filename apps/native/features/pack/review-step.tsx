import { formatKg, formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { reasonLabel } from "@/features/press/reason-label";

import { typedCount } from "./pack-card";
import type { PickedDie } from "./pack-form";
import { draftTotals, type DraftBundle, type DraftReject, type YardOption } from "./pack-math";
import { useLinesPreview } from "./use-pack-server";
import { DriftChip, VerdictChip } from "./verdict-chip";

export type SaveProblem = {
  /** "unsure": it may have saved. Save stays on screen: the same request id replays the first answer. */
  kind: string;
  title: string;
  body: string;
};

/** The Source step's choices in words, for the summary card. */
export type SourceSummary = { forOrder: string | null; copy: string | null; cast: string | null };

export type ReviewStepProps = {
  die: PickedDie;
  dieInstanceId?: string;
  defaultLengthMm: number;
  formatLength: (mm: number) => string;
  po: string;
  yard: YardOption | null;
  source: SourceSummary;
  bundles: DraftBundle[];
  rejects: DraftReject[];
  saving: boolean;
  problem: SaveProblem | null;
  onSave: () => void;
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

/** Step 3: read it over, then save. Retrying after an unsure answer is safe: the same bundles are never packed twice. */
export function ReviewStep(p: ReviewStepProps) {
  const { t } = useT();
  const totals = draftTotals(p.bundles);
  const saved = useLinesPreview(
    p.die.id,
    p.dieInstanceId,
    p.bundles.map((b) => ({ lengthMm: b.lengthMm ?? p.defaultLengthMm, weightG: b.weightG, pcs: b.pieces })),
  );
  const outside = saved.verdicts.filter((v) => v.position === "below" || v.position === "above").length;
  const typed = typedCount(p.bundles);
  const rejectPcs = p.rejects.reduce((s, r) => s + r.pcs, 0);

  return (
    <View className="gap-4">
      <View className="gap-2 rounded-card border border-hairline bg-surface p-4">
        <Text className="font-display-bold text-xl text-ink">{p.die.label}</Text>
        <Fact label={t("pack.forOrder")} value={p.source.forOrder ?? t("pack.plantStock")} />
        {p.source.copy ? <Fact label={t("pack.source.copy")} value={p.source.copy} /> : null}
        {p.source.cast ? <Fact label={t("pack.source.cast")} value={p.source.cast} /> : null}
        <Fact label={t("pack.new.cutLength")} value={p.formatLength(p.defaultLengthMm)} />
        {p.po.trim() ? <Fact label={t("pack.new.po")} value={p.po.trim()} /> : null}
        {p.yard ? <Fact label={t("native.pack.yard")} value={p.yard.code} /> : null}
        <Fact label={t("pack.new.totalBundles")} value={String(totals.bundles)} />
        <Fact label={t("pack.new.totalPieces")} value={String(totals.pieces)} />
        <Fact label={t("pack.new.totalKg")} value={formatKgTotal(gToKg(totals.weightG))} />
        {rejectPcs > 0 ? <Fact label={t("pack.reject.title")} value={t("pack.reject.saved", { count: rejectPcs })} /> : null}
      </View>
      {outside > 0 ? <Text className="font-sans text-sm text-tone-amber-ink">{t("native.pack.outOfRange", { count: outside })}</Text> : null}
      {typed > 0 ? <Text className="font-sans text-sm text-ink-muted">{t("pack.scale.typedCount", { count: typed })}</Text> : null}

      <View className="gap-2">
        {p.bundles.map((b, i) => {
          const v = saved.verdicts[i] ?? null;
          return (
            <View key={b.key} className="flex-row items-center justify-between gap-3 rounded-card border border-hairline bg-surface px-4 py-3">
              <View className="min-w-0 flex-1">
                <Text className="font-sans-semibold text-base text-ink">{t("pack.new.bundleNumber", { n: i + 1 })}</Text>
                <Text className="font-mono text-sm text-ink-muted">{t("native.pack.bundleLine", { kg: formatKg(gToKg(b.weightG)), pieces: b.pieces })}</Text>
              </View>
              <View className="items-end gap-1">
                <VerdictChip verdict={v} />
                <DriftChip verdict={v} />
              </View>
            </View>
          );
        })}
        {p.rejects.map((r, i) => (
          <Text key={`${i}-${r.reasonCode}`} className="font-sans text-sm text-ink-muted">
            {[t("pack.reject.saved", { count: r.pcs }), reasonLabel(t, "qc_reject", r.reasonCode, r.reasonCode), r.weightG ? `${formatKgTotal(gToKg(r.weightG))} ${t("units.kg")}` : null].filter(Boolean).join(", ")}
          </Text>
        ))}
      </View>

      {p.problem ? (
        <View accessibilityLiveRegion="polite" className="gap-1 rounded-card bg-tone-red-tint p-4">
          <Text className="font-sans-semibold text-base text-tone-red-ink">{p.problem.title}</Text>
          {p.problem.body ? <Text className="font-sans text-[15px] leading-6 text-tone-red-ink">{p.problem.body}</Text> : null}
        </View>
      ) : null}

      <Button size="lg" label={t("pack.new.saveOnly")} loading={p.saving} loadingLabel={t("common.saving")} onPress={p.onSave} />
      <Button variant="ghost" label={t("native.pack.editBundles")} disabled={p.saving} onPress={p.onBack} />
    </View>
  );
}
