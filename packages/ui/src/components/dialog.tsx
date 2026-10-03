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
            // Phones: a bottom sheet (full width, rounded top, safe-area
            // padding, slides up). From sm: the centred card dialog.
            "fixed inset-x-0 bottom-0 z-50 grid max-h-[calc(100dvh-1.5rem)] w-full gap-5 overflow-y-auto rounded-t-card border border-b-0 border-border bg-popover px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-6 text-popover-foreground shadow-lg duration-300 ease-[var(--ease-spring)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border-b sm:p-6 sm:duration-200 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          )}
          style={{ maxWidth }}
        >
          <div aria-hidden="true" className="mx-auto -mt-3 h-1.5 w-10 rounded-full bg-control/50 sm:hidden" />
          {title || description ? (
            <div className="flex min-w-0 flex-col gap-1.5 pr-10">
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

          {actions ? (
            // Phones: actions stack full width with the primary (last) on top.
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto max-sm:[&>div]:flex-col-reverse max-sm:[&>div>*]:w-full">
              {actions}
            </div>
          ) : null}

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
