import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { ScreenTitle } from "@/components/ui/screen-title";

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  /** A chip, a button or a how-to link on the right. */
  right?: ReactNode;
  size?: "lg" | "md";
};

/** The heading a screen draws for itself (detail pages, where the stack title is small). */
export function PageHeader({ title, subtitle, right, size = "md" }: PageHeaderProps) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <View className="min-w-0 flex-1 gap-1">
        <ScreenTitle size={size}>{title}</ScreenTitle>
        {subtitle ? <Text className="font-sans text-[15px] text-ink-muted">{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}
