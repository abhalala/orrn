"use client";

import { useT } from "@orrn/i18n";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { escapeUnlessComboboxOpen } from "@orrn/ui/lib/escape";
import { useReturnFocus } from "@orrn/ui/lib/return-focus";
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
  const { t } = useT();
  const returnFocus = useReturnFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="dialog-overlay"
          className="orrn-overlay fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] dark:bg-black/65"
        />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          {...returnFocus}
          onEscapeKeyDown={escapeUnlessComboboxOpen}
          // The content box itself never scrolls (the inner div does), so a
          // portalled combobox list positioned inside it is never clipped.
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-border bg-popover text-popover-foreground shadow-lg outline-none duration-200 ease-[var(--ease-spring)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          style={{ maxWidth }}
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="grid min-h-0 gap-5 overflow-y-auto overscroll-contain p-6">
            {title || description ? (
              <div className="flex min-w-0 flex-col gap-1.5 pr-10">
                {title ? (
                  <DialogPrimitive.Title className="m-0 font-display text-[22px] font-bold leading-tight tracking-[-0.025em] break-words">
                    {title}
                  </DialogPrimitive.Title>
                ) : null}
                {description ? (
                  <DialogPrimitive.Description className="m-0 text-[15px] leading-6 text-muted-foreground">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
              </div>
            ) : null}

            {children}

            {actions ? (
              // Phones: full-width stack, primary (last) on top. Wider: a row, primary on the right.
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
                {actions}
              </div>
            ) : null}
          </div>

          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute right-3 top-3 flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" aria-hidden="true" strokeWidth={2} />
            <span className="sr-only">{t("common.close")}</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DialogCloseButton({
  onPress,
  children,
}: {
  onPress: () => void;
  children?: ReactNode;
}) {
  const { t } = useT();
  return (
    <Button variant="secondary" onPress={onPress}>
      {children ?? t("common.cancel")}
    </Button>
  );
}
