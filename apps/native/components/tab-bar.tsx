// Per-family import: the package index would bundle every icon font (~5 MB).
import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { c2, tones } from "@orrn/ui/tokens";
import * as Haptics from "expo-haptics";
import { useRouter, type Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/lib/theme";
import { placeScan, TAB_ROUTES, visibleTabs, type TabName } from "@/lib/nav";
import { useMe } from "@/utils/me";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** Tabs shrink a touch more than buttons: the target is small and the glyph light. */
const TAB_PRESS_SCALE = 0.95;

function TabItem({
  label,
  icon,
  focused,
  onPress,
  onLongPress,
}: {
  label: string;
  icon: ComponentProps<typeof Feather>["name"];
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const ink = useThemeColor("foreground");
  const muted = useThemeColor("muted-foreground");

  return (
    <PressableScale
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      scaleTo={TAB_PRESS_SCALE}
      className="min-h-[60px] min-w-0 flex-1 items-center justify-center gap-0.5 rounded-card pb-1 pt-1.5"
    >
      <View className={cn("h-8 w-14 items-center justify-center rounded-full", focused && "bg-surface-sunken")}>
        <Feather name={icon} size={22} color={focused ? ink : muted} />
      </View>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        className={cn("px-0.5 text-[11px] leading-4", focused ? "font-sans-semibold text-ink" : "font-sans-medium text-ink-muted")}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

function ScanButton({ label, focused, onPress }: { label: string; focused: boolean; onPress: () => void }) {
  const { t } = useT();
  const ring = useThemeColor("card");

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t("native.scanHint")}
      accessibilityState={{ selected: focused }}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        onPress();
      }}
      scaleTo={TAB_PRESS_SCALE}
      className="-mt-5 min-w-0 flex-1 items-center gap-0.5 pb-1"
    >
      <View
        className="h-[60px] w-[60px] items-center justify-center rounded-full bg-tone-green"
        style={{
          borderWidth: 4,
          borderColor: ring,
          shadowColor: c2.light.ink,
          shadowOpacity: 0.18,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Feather name="maximize" size={26} color={tones.green.on} />
      </View>
      <Text numberOfLines={1} maxFontSizeMultiplier={1.3} className="text-[11px] leading-4 font-sans-semibold text-ink">
        {label}
      </Text>
    </PressableScale>
  );
}

/**
 * Phone and iPad tab bar: Today · Pack · [Scan] · Stock · Dispatch for the floor,
 * Today · Dies · [Scan] · Press · More for the die room and Today · Dispatch ·
 * [Scan] · Orders · More for the office (lib/nav.ts), mirroring the web phone bar. Scan is the raised green button in the middle of whatever
 * tabs this person can see (hidden tabs are removed by `Tabs.Protected`, so
 * they never reach `state.routes`). Always visible (ruling R23).
 */
export function TabBar({ state, descriptors, navigation, insets }: TabBarProps) {
  const { t } = useT();
  const router = useRouter();
  const { data: me } = useMe();
  // Routes the person can open from More (Orders, Dies) are in the navigator but not on the bar.
  const onBar = new Set(visibleTabs(me));
  const order = placeScan(state.routes.map((r) => r.name as TabName).filter((n) => onBar.has(n)));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t("nav.main")}
      className="border-t border-hairline bg-surface"
      style={{ paddingBottom: Math.max(insets.bottom, 6) }}
    >
      <View className="w-full max-w-[640px] flex-row items-end gap-1 self-center px-2 pt-1">
        {order.map((name) => {
          const route = state.routes.find((r) => r.name === name);
          const meta = TAB_ROUTES.find((tab) => tab.name === name);
          if (!route || !meta) return null;
          const focused = state.routes[state.index]?.key === route.key;
          const label = (descriptors[route.key]?.options.title as string | undefined) ?? t(meta.labelKey);

          const onPress = () => {
            // More is the stack the avatar opens, not a tab screen: it opens on top of the tabs.
            if (name === "menu") {
              router.navigate("/more");
              return;
            }
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            // A focused stack tab pops to its root on its own (native-stack listens for tabPress).
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });

          if (name === "scan") return <ScanButton key={route.key} label={label} focused={focused} onPress={onPress} />;
          return (
            <TabItem
              key={route.key}
              label={label}
              icon={meta.icon}
              focused={focused}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          );
        })}
      </View>
    </View>
  );
}
