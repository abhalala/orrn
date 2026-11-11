import { useT } from "@orrn/i18n";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";

import type { HoldTarget } from "./hold-sheet";
import { orderKgText } from "./order-model";

export function SheetErrors({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" className="gap-1 rounded-input bg-tone-red-tint px-4 py-3">
      {lines.map((line) => (
        <Text key={line} className="font-sans-medium text-[15px] leading-6 text-tone-red-ink">
          {line}
        </Text>
      ))}
    </View>
  );
}

export function HoldActions({
  target,
  openOrder,
  heldG,
  heldBundles,
  onHold,
  onHeld,
}: {
  target: HoldTarget;
  openOrder: boolean;
  heldG: number;
  heldBundles: number;
  onHold: (target: HoldTarget) => void;
  onHeld: (target: HoldTarget) => void;
}) {
  const { t } = useT();
  if (!openOrder && heldG <= 0) return null;
  return (
    <Can do="order.manage">
      <View className="flex-row flex-wrap items-center gap-2">
        {heldG > 0 ? <Chip tone="blue" label={t("orders.hold.chip", { count: heldBundles, kg: orderKgText(heldG) })} /> : null}
        {openOrder ? <Button variant="secondary" testID={`hold-stock-${target.lineNo}`} label={t("orders.hold.button")} onPress={() => onHold(target)} /> : null}
        {heldG > 0 ? <Button variant="ghost" testID={`held-stock-${target.lineNo}`} label={t("orders.hold.list")} onPress={() => onHeld(target)} /> : null}
      </View>
    </Can>
  );
}
