import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { ScrollView, Text } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";

import { STATUS_FILTERS, type StatusFilterValue } from "./bundle-search";

/** All, In stock, Held, Dispatched, Void as pills. A radio group: the chosen one says it is selected. */
export function StatusFilter({ value, onChange }: { value: StatusFilterValue; onChange: (next: StatusFilterValue) => void }) {
  const { t } = useT();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel={t("stock.filterStatus")}
      contentContainerClassName="gap-2"
      keyboardShouldPersistTaps="handled"
    >
      {STATUS_FILTERS.map((option) => {
        const selected = option === value;
        const label = option === "all" ? t("common.all") : t(`status.bundle.${option}`);
        return (
          <PressableScale
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ checked: selected, selected }}
            onPress={() => onChange(option)}
            className={cn("min-h-11 justify-center rounded-full border px-4", selected ? "border-transparent bg-primary" : "border-control bg-surface")}
          >
            <Text className={cn("text-[15px]", selected ? "font-sans-semibold text-primary-foreground" : "font-sans text-ink")}>{label}</Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
