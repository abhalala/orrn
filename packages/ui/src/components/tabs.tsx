import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Button } from "./button";

export type TabItem = {
  id: string;
  label: ReactNode;
};

export type TabsProps = {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children?: ReactNode;
};

/**
 * Pill-style tab strip. Keeps the simple `items`/`value`/`onValueChange`
 * shape from the Tamagui implementation so consumers don't have to change.
 */
export function Tabs({ items, value, onValueChange, className, children }: TabsProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap gap-1">
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
      </div>
      {children}
    </div>
  );
}
