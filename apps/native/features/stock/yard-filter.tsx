import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { activeYards } from "@/features/pack/pack-math";
import { trpc } from "@/utils/trpc";

/** The yards worth a filter: a plant with one yard has nothing to choose between. */
export function useYards() {
  const locations = useQuery({ ...trpc.stock.locations.list.queryOptions(), staleTime: 5 * 60_000 });
  return activeYards(locations.data?.items);
}

/** All yards, then each yard by its code, as radio pills (the stock lists filter by `locationId`, FP-PK-08). */
export function YardFilter({ value, onChange }: { value: string | undefined; onChange: (next: string | undefined) => void }) {
  const { t } = useT();
  const yards = useYards();
  if (yards.length < 2) return null;
  const options: { id: string | undefined; label: string }[] = [{ id: undefined, label: t("native.stock.allYards") }, ...yards.map((y) => ({ id: y.id, label: y.code }))];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={t("native.stock.yard")} contentContainerClassName="gap-2" keyboardShouldPersistTaps="handled">
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <PressableScale
            key={o.id ?? "all"}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: selected, selected }}
            onPress={() => onChange(o.id)}
            className={cn("min-h-11 justify-center rounded-full border px-4", selected ? "border-transparent bg-primary" : "border-control bg-surface")}
          >
            <Text className={cn("text-[15px]", selected ? "font-sans-semibold text-primary-foreground" : "font-sans text-ink")}>{o.label}</Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
