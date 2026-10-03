"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Snap-point hint. The web sheet renders as a bottom slide-up dialog; the
   * first snap point is treated as the desired height percentage.
   */
  snapPoints?: number[];
  children: ReactNode;
};

/**
 * Bottom-sheet primitive. On web this is a Radix Dialog styled as a
 * slide-up sheet from the bottom edge. The native variant uses RN
 * primitives (see `sheet.native.tsx`).
 */
export function Sheet({ open, onOpenChange, snapPoints = [80], children }: SheetProps) {
  const heightPct = snapPoints[0] ?? 80;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-2xl flex-col gap-3 rounded-t-card border border-b-0 border-border bg-popover px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 text-popover-foreground shadow-lg duration-300 ease-[var(--ease-spring)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          )}
          style={{ maxHeight: `${heightPct}vh` }}
        >
          <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-control/50" aria-hidden />
          <div className="flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
