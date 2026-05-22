import type { ReactNode } from "react";

import { XStack, YStack } from "@orrn/ui/lib/tg";

import { Button } from "./button";

export type TabItem = {
  id: string;
  label: ReactNode;
};

export type TabsProps = {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  children?: ReactNode;
};

/**
 * Lightweight tabs as a strip of pill buttons.
 */
export function Tabs({ items, value, onValueChange, children }: TabsProps) {
  return (
    <YStack gap={12}>
      <XStack gap={4} flexWrap="wrap">
        {items.map((it) => (
          <Button
            key={it.id}
            variant={value === it.id ? "default" : "outline"}
            size="sm"
            onPress={() => onValueChange(it.id)}
          >
            {it.label}
          </Button>
        ))}
      </XStack>
      {children}
    </YStack>
  );
}
