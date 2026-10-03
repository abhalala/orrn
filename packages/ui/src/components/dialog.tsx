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
          className="fixed inset-0 z-50 bg-black/55 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-card border border-border bg-popover p-6 text-popover-foreground shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          style={{ maxWidth }}
        >
          {title || description ? (
            <div className="flex flex-col gap-1.5 pr-10">
              {title ? (
                <DialogPrimitive.Title className="m-0 text-lg font-semibold leading-snug tracking-[-0.015em]">{title}</DialogPrimitive.Title>
              ) : null}
              {description ? (
                <DialogPrimitive.Description className="m-0 text-sm leading-6 text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
          ) : null}

          {children}

          {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}

          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" aria-hidden="true" />
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
