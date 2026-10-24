import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";

export type EmptyStateProps = {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Nothing here yet: what is missing, why, and the one thing to do about it. */
export function EmptyState({ title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="items-center gap-3 rounded-card border border-hairline bg-surface p-6">
      <Text accessibilityRole="header" className="text-center font-display-bold text-lg text-ink">
        {title}
      </Text>
      {body ? <Text className="text-center font-sans text-[15px] leading-6 text-ink-muted">{body}</Text> : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} className="mt-1 self-stretch" /> : null}
    </View>
  );
}
