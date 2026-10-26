import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/lib/theme";
import { useLengthUnit } from "@/utils/length";

import { kgBundle, kgTotal } from "./format";
import type { DispatchItemLike, ItemGroup } from "./group-items";

/**
 * One group of a dispatch: its label (a packing group label, else the
 * section) with the group's bundles and kg, then a row per bundle. Opening a
 * row shows the bundle; the cross removes it from the dispatch; the pencil
 * labels or relabels the whole group.
 */
export function GroupCard<T extends DispatchItemLike>({
  group,
  editable,
  onEditLabel,
  onRemove,
}: {
  group: ItemGroup<T>;
  editable: boolean;
  onEditLabel: (group: ItemGroup<T>) => void;
  onRemove: (item: T) => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const ink = useThemeColor("foreground");
  const muted = useThemeColor("muted-foreground");
  const length = useLengthUnit();
  const total = t("dispatch.build.groupTotal", { bundles: group.bundles.length, kg: kgTotal(group.weightG) });

  return (
    <View className="overflow-hidden rounded-card border border-hairline bg-surface">
      <View className="flex-row items-center gap-2 border-b border-hairline px-4 py-2">
        <View accessible accessibilityLabel={`${group.label}, ${total}`} className="min-w-0 flex-1 py-1">
          <Text className="font-display-bold text-lg text-ink">{group.label}</Text>
          <Text className="font-sans text-sm text-ink-muted">{total}</Text>
        </View>
        {editable ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${group.labelled ? t("native.dispatch.editLabel") : t("native.dispatch.addLabel")}, ${group.label}`}
            onPress={() => onEditLabel(group)}
            className="h-11 w-11 items-center justify-center rounded-full"
          >
            <Feather name="tag" size={20} color={ink} />
          </PressableScale>
        ) : null}
      </View>
      {group.bundles.map((b, index) => (
        <View key={b.itemId} className={index > 0 ? "flex-row items-center border-t border-hairline" : "flex-row items-center"}>
          <PressableScale
            accessibilityRole="link"
            accessibilityLabel={`${b.serial}, ${t("native.dispatch.bundleMeta", { pcs: b.quantity, length: length.formatLength(b.lengthMm), kg: kgBundle(b.weightG) })}`}
            onPress={() => router.push({ pathname: "/b/[serial]", params: { serial: b.serial } })}
            className="min-h-14 min-w-0 flex-1 justify-center px-4 py-2"
          >
            <Text className="font-mono-semibold text-base text-ink">{b.serial}</Text>
            <Text className="font-sans text-sm text-ink-muted">{t("native.dispatch.bundleMeta", { pcs: b.quantity, length: length.formatLength(b.lengthMm), kg: kgBundle(b.weightG) })}</Text>
          </PressableScale>
          {editable ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t("dispatch.build.removeBundle", { serial: b.serial })}
              onPress={() => onRemove(b)}
              className="h-14 w-12 items-center justify-center"
            >
              <Feather name="x" size={20} color={muted} />
            </PressableScale>
          ) : null}
        </View>
      ))}
    </View>
  );
}
