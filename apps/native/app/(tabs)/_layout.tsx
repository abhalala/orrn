import { useT } from "@orrn/i18n";
import { Tabs } from "expo-router";

import { TabBar } from "@/components/tab-bar";
import { useThemeColor } from "@/lib/theme";
import { TAB_ROUTES, visibleTabs } from "@/lib/nav";
import { useMe } from "@/utils/me";

/**
 * Today · Pack · [Scan] · Stock · Dispatch (spec §4, replaces the drawer, N1).
 * Tabs this person can't use (role or company modules, same rules as the web
 * tab bar) are wrapped in `Tabs.Protected`, so they vanish from the bar and a
 * deep link to them falls back to Today. Each stack tab owns its own header.
 */
export default function TabsLayout() {
  const { t } = useT();
  const { data: me } = useMe();
  const canvas = useThemeColor("background");
  const visible = new Set(visibleTabs(me));

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: canvas } }}
    >
      {TAB_ROUTES.map((tab) => (
        <Tabs.Protected key={tab.name} guard={visible.has(tab.name)}>
          <Tabs.Screen name={tab.name} options={{ title: t(tab.labelKey) }} />
        </Tabs.Protected>
      ))}
    </Tabs>
  );
}
