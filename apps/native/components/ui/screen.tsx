import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { useThemeColor } from "@/lib/theme";

export type ScreenProps = {
  children: ReactNode;
  /** Pull to refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  className?: string;
};

/**
 * The scrolling page every screen sits in: canvas, 16px gutters, a centred
 * column (max 720) so an iPad does not stretch lines, and the iOS large-title
 * inset. Pull-to-refresh when the screen gives `onRefresh`.
 */
export function Screen({ children, onRefresh, refreshing = false, className }: ScreenProps) {
  const ink = useThemeColor("foreground");
  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="px-4 pb-12 pt-3"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ink} /> : undefined}
    >
      <View className={cn("w-full max-w-[720px] gap-4 self-center", className)}>{children}</View>
    </ScrollView>
  );
}
