import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "@/components/brand-mark";

/**
 * Full-screen message for states outside the tabs: no access, offline. One
 * heading, plain body, and the next action(s) at the bottom within thumb reach.
 */
export function MessageScreen({
  title,
  body,
  children,
}: {
  title: string;
  body?: ReactNode;
  /** Action buttons, primary first. */
  children?: ReactNode;
}) {
  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "bottom", "left", "right"]}>
      <ScrollView
        contentContainerClassName="grow justify-between gap-10 px-4 py-6"
        contentInsetAdjustmentBehavior="automatic"
      >
        <View className="w-full max-w-[480px] gap-6 self-center">
          <BrandMark size={36} />
          <View className="gap-3">
            <Text accessibilityRole="header" className="font-display-extrabold text-[30px] leading-9 tracking-tight text-ink">
              {title}
            </Text>
            {typeof body === "string" ? (
              body ? <Text className="font-sans text-base leading-6 text-ink-muted">{body}</Text> : null
            ) : (
              (body ?? null)
            )}
          </View>
        </View>
        {children ? <View className="w-full max-w-[480px] gap-3 self-center">{children}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
