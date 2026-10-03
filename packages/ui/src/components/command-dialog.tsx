"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { useReturnFocus } from "@orrn/ui/lib/return-focus";
import { cn } from "@orrn/ui/lib/utils";

export type CommandDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name of the dialog (not shown; the input carries the visible hint). */
  label: string;
  children: ReactNode;
  className?: string;
};

/**
 * Frame for a command palette ("Scan or search", ⌘K): a modal panel near the
 * top of the screen, full width on phones and 640px on wider screens, on
 * Radix Dialog (focus trap, Escape, scroll lock, focus back to the opener).
 * The caller renders the combobox input and the result list inside.
 */
export function CommandDialog({ open, onOpenChange, label, children, className }: CommandDialogProps) {
  const returnFocus = useReturnFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="dialog-overlay"
          className="orrn-overlay fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] dark:bg-black/65"
        />
        <DialogPrimitive.Content
          data-slot="command-dialog"
          aria-describedby={undefined}
          {...returnFocus}
          className={cn(
            "fixed top-2 left-1/2 z-50 flex max-h-[min(600px,calc(100dvh-1rem))] w-[calc(100%-1rem)] -translate-x-1/2 flex-col overflow-hidden rounded-card border border-border bg-popover text-popover-foreground shadow-lg outline-none",
            "sm:top-[max(1rem,12dvh)] sm:max-h-[min(600px,calc(100dvh-2rem))] sm:w-[calc(100%-2rem)] sm:max-w-[640px]",
            "duration-200 ease-[var(--ease-spring)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[0.98] data-[state=open]:zoom-in-[0.98]",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
