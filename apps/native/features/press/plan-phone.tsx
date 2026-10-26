import { bpPercent1, formatKgTotal, gToKg, type PlanDieState } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { useLengthUnit } from "@/utils/length";
import { trpc } from "@/utils/trpc";

import { PLAN_DIE_TONE, planBarWidth, planDieLabelKey } from "./plan-phone-model";

const kg = (g: number) => formatKgTotal(gToKg(g));

/**
 * FP-OP-21 (W4-NEXTROWS): the released press plans and today's press figures on the owner's phone,
 * read-only (`plans.phone`). Per die: cut lengths, pressed against planned pcs/kg, run chip.
 */
export function PlanPhone({ pollMs }: { pollMs: number }) {
  const { t } = useT();
  const lu = useLengthUnit();
  const q = useQuery({ ...trpc.plans.phone.queryOptions({}), refetchInterval: pollMs });
  if (!q.data) return null;
  const { plans, summary } = q.data;
  return (
    <View className="gap-3" accessibilityLabel={t("native.press.planHeading")}>
      <View className="gap-1 rounded-card border border-hairline bg-surface p-4">
        <Text className="font-sans-semibold text-base text-ink">{t("press.summary.pressedToday")}</Text>
        <Text className="font-sans text-sm text-ink-muted">
          {t("native.press.planToday", { kg: kg(summary.kgG), runs: summary.runs, min: summary.downtimeMin })}
          {summary.runs > 0 && summary.recoveryBp !== null ? `, ${t("press.summary.recovery")} ${bpPercent1(summary.recoveryBp)}%` : ""}
        </Text>
      </View>
      {plans.length === 0 ? (
        <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("native.press.planNone")}</Text>
      ) : (
        plans.map((p) => (
          <View key={p.id} className="gap-2 rounded-card border border-hairline bg-surface p-4">
            <Text className="font-sans-semibold text-base text-ink">
              {p.number}
              {p.pressLine ? `, ${p.pressLine.code}` : ""}
            </Text>
            <Text className="font-sans text-sm text-ink-muted">{t("native.press.planKg", { pressed: kg(p.pressedG), planned: kg(p.plannedG) })}</Text>
            {p.dies.map((d) => (
              <View key={d.id} className="gap-1 border-t border-hairline pt-2">
                <View className="flex-row flex-wrap items-center justify-between gap-2">
                  <Text className="font-sans-semibold text-[15px] text-ink">{d.sectionCode}</Text>
                  <Chip tone={PLAN_DIE_TONE[d.state as PlanDieState]} label={t(planDieLabelKey(d.state as PlanDieState) as MessageKey)} />
                </View>
                <View className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken" importantForAccessibility="no">
                  <View className="h-full bg-primary" style={{ width: planBarWidth(d.pressedBp) }} />
                </View>
                {d.lengths.map((l) => (
                  <Text key={l.cutLengthMm} className="font-sans text-sm text-ink-muted">
                    {lu.formatLength(l.cutLengthMm)}: {t("native.press.planKg", { pressed: kg(l.pressedG), planned: kg(l.plannedG) })}
                    {l.plannedPcs > 0 || l.pressedPcs > 0 ? `, ${t("native.press.planPcs", { pressed: l.pressedPcs, planned: l.plannedPcs })}` : ""}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  );
}
