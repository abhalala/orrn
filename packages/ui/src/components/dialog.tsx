"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Button } from "./button";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  maxWidth?: number;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  maxWidth = 480,
}: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="dialog-overlay"
          className="fixed inset-0 z-50 bg-black/65 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 grid w-[90%] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          style={{ maxWidth }}
        >
          {title || description ? (
            <div className="flex flex-col gap-1">
              {title ? (
                <DialogPrimitive.Title className="m-0 text-base font-semibold">{title}</DialogPrimitive.Title>
              ) : null}
              {description ? (
                <DialogPrimitive.Description className="m-0 text-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
          ) : null}

          {children}

          {actions ? <div className="flex justify-end gap-2">{actions}</div> : null}

          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute right-3 top-3 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DialogCloseButton({
  onPress,
  children = "Cancel",
}: {
  onPress: () => void;
  children?: ReactNode;
}) {
  return (
    <Button variant="outline" onPress={onPress}>
      {children}
    </Button>
  );
}
