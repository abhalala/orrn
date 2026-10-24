import type { DispatchStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Text, View } from "react-native";

import { currentStep } from "./next-step";

const STEP_KEYS = ["dispatch.steps.build", "dispatch.steps.hold", "dispatch.steps.dispatch"] as const;

/** Build, Hold, Dispatch as three bars with their words. Done and current steps are filled; the word says which, so colour is never the only signal. */
export function DispatchStepper({ status }: { status: DispatchStatus }) {
  const { t } = useT();
  const current = currentStep(status);
  if (current < 0) return null;
  return (
    <View accessibilityRole="list" accessibilityLabel={t("native.dispatch.stepsLabel")} className="flex-row gap-2">
      {STEP_KEYS.map((key, index) => {
        const done = index < current;
        const isCurrent = index === current;
        const state = done ? t("ui.stepDone") : isCurrent ? t("ui.stepCurrent") : "";
        const label = [t("ui.stepOf", { n: index + 1, total: STEP_KEYS.length }), t(key), state].filter(Boolean).join(", ");
        return (
          <View key={key} accessible accessibilityLabel={label} className="min-w-0 flex-1 gap-1.5">
            <View className={cn("h-1.5 rounded-full", done || isCurrent ? "bg-primary" : "bg-surface-sunken")} />
            <Text numberOfLines={2} className={cn("text-sm", isCurrent ? "font-sans-semibold text-ink" : "font-sans text-ink-muted")}>
              {t(key)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
