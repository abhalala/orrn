import type { ReactNode } from "react";
import { View } from "react-native";

/**
 * The strip pinned under a dispatch screen: the next step as one large
 * button, reachable with a thumb. It sits above the tab bar, which already
 * clears the home indicator, so it adds no inset of its own.
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return <View className="gap-2 border-t border-hairline bg-surface px-4 pb-3 pt-3">{children}</View>;
}
