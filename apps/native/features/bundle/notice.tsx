import { cn } from "@orrn/ui/lib/utils";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";

export type BundleNotice = { tone: "success" | "neutral" | "error"; text: string; dispatchId?: string };

const BOX = { success: "bg-tone-green-tint", neutral: "bg-tone-neutral-tint", error: "bg-tone-red-tint" } as const;
const INK = { success: "text-tone-green-ink", neutral: "text-tone-neutral-ink", error: "text-tone-red-ink" } as const;

/** What just happened to the bundle, in a live region so it is read out. With a dispatch it can open it. */
export function NoticeBanner({ notice, actionLabel, onAction }: { notice: BundleNotice; actionLabel?: string; onAction?: () => void }) {
  return (
    <View accessibilityLiveRegion="polite" className={cn("gap-2 rounded-card p-4", BOX[notice.tone])}>
      <Text className={cn("font-sans-semibold text-[15px] leading-6", INK[notice.tone])}>{notice.text}</Text>
      {actionLabel && onAction ? <Button variant="secondary" label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}
