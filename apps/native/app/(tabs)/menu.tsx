import { Redirect } from "expo-router";

/**
 * More is not a tab screen: the tab bar opens the More stack on top of the tabs (components/tab-bar.tsx).
 * This file only exists so the bar has a route to draw; a link that lands here goes on to More.
 */
export default function MenuTab() {
  return <Redirect href="/more" />;
}
