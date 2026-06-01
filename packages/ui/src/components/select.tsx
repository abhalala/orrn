"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@orrn/ui/lib/utils";

export type SelectOption = { label: string; value: string };

export type SelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Legacy Tamagui prop — accepted but renders as a width style. */
  width?: number | string;
};

/**
 * Cross-platform-shaped select. Web variant uses Radix Select; native uses
 * RN primitives via the `.native.tsx` extension.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled,
  className,
  width,
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        className={cn(
          "flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
          className,
        )}
        style={width != null ? { width } : undefined}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          position="popper"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 cursor-default items-center justify-center">
            <ChevronUp className="size-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-7 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
              >
                <span className="absolute left-2 flex size-3.5 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="size-4" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-6 cursor-default items-center justify-center">
            <ChevronDown className="size-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
