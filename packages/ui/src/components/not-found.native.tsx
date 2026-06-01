// @ts-nocheck — native implementation is resolved from apps/native; workspace-local RN types do not line up inside packages/ui.
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { cn } from "@orrn/ui/lib/utils";

const RECOVERY_POINTS = ["Route checked", "Tenant scope preserved", "No data exposed"] as const;

export type NotFoundPageProps = {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
};

export function NotFoundPage({
  eyebrow = "404 / Not found",
  title = "This work order is off the route.",
  description = "The page may have moved, the link may be stale, or your current company does not have access to it.",
  primaryAction,
  secondaryAction,
  className,
}: NotFoundPageProps) {
  return (
    <View className={cn("flex-1 justify-center bg-background px-5 py-8", className)}>
      <View className="items-center gap-6">
        <View className="items-center gap-3">
          <View className="flex-row items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
            <View className="size-2 rounded-full bg-primary" />
            <Text className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {eyebrow}
            </Text>
          </View>

          <Text
            aria-hidden
            className="font-mono text-8xl font-semibold tracking-tighter text-muted"
          >
            404
          </Text>
          <Text className="max-w-sm text-center text-3xl font-semibold leading-tight text-foreground">
            {title}
          </Text>
          <Text className="max-w-sm text-center text-base leading-6 text-muted-foreground">
            {description}
          </Text>
        </View>

        <View className="w-full max-w-sm rounded-2xl border border-border bg-card p-4">
          <View className="mb-4 flex-row items-center justify-between border-b border-border pb-3">
            <View className="flex-row gap-2">
              <View className="size-2.5 rounded-full bg-red-500" />
              <View className="size-2.5 rounded-full bg-yellow-400" />
              <View className="size-2.5 rounded-full bg-emerald-500" />
            </View>
            <Text className="font-mono text-xs text-muted-foreground">orrn://ops/not-found</Text>
          </View>

          <View className="gap-2 rounded-xl border border-border bg-background p-3">
            {RECOVERY_POINTS.map((point) => (
              <View
                key={point}
                className="flex-row items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
              >
                <Text className="text-sm text-muted-foreground">{point}</Text>
                <Text className="font-mono text-xs font-semibold text-primary">OK</Text>
              </View>
            ))}
          </View>
        </View>

        {(primaryAction || secondaryAction) ? (
          <View className="w-full max-w-sm gap-3">
            {primaryAction}
            {secondaryAction}
          </View>
        ) : null}
      </View>
    </View>
  );
}
