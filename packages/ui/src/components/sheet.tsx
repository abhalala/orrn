"use client";

import { useT } from "@orrn/i18n";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { escapeUnlessComboboxOpen } from "@orrn/ui/lib/escape";
import { useReturnFocus } from "@orrn/ui/lib/return-focus";
import { cn } from "@orrn/ui/lib/utils";

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible title; also the dialog's accessible name. */
  title: string;
  children: ReactNode;
  /** Sticky action bar at the bottom (primary action last). */
  footer?: ReactNode;
  /** One line under the title, read with it. */
  description?: string;
  className?: string;
};

/**
 * C2 sheet on Radix Dialog (focus trap, Escape, focus returns to the trigger).
 * Below 1024px it is a bottom sheet that springs up (rounded top, grabber,
 * up to 92% of the screen, safe-area padding); from 1024px it is a panel
 * that slides in from the right, full height, 440px wide. The body scrolls;
 * the header and footer stay put.
 */
export function Sheet({ open, onOpenChange, title, children, footer, description, className }: SheetProps) {
  const { t } = useT();
  const returnFocus = useReturnFocus();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="sheet-overlay"
          className="orrn-overlay fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px] dark:bg-black/65"
        />
        <DialogPrimitive.Content
          data-slot="sheet"
          {...returnFocus}
          onEscapeKeyDown={escapeUnlessComboboxOpen}
          // No description: tell Radix explicitly so it doesn't point at a missing node.
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "orrn-sheet fixed z-50 flex flex-col bg-popover text-popover-foreground shadow-lg outline-none",
            // Phone and iPad portrait: bottom sheet.
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-card border-t border-border",
            // From 1024px: right-hand panel.
            "lg:inset-y-0 lg:right-0 lg:left-auto lg:h-dvh lg:max-h-none lg:w-[440px] lg:max-w-[calc(100vw-2rem)] lg:rounded-t-none lg:rounded-l-card lg:border-t-0 lg:border-l",
            className,
          )}
        >
          <div aria-hidden="true" className="flex justify-center pt-2.5 pb-1 lg:hidden">
            <span className="h-1.5 w-10 rounded-full bg-control/45" />
          </div>
          <div className="flex items-start gap-3 px-5 pt-2 pb-3 lg:px-6 lg:pt-5">
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1.5">
              <DialogPrimitive.Title className="m-0 font-display text-[22px] font-bold leading-tight tracking-[-0.025em] break-words">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="m-0 text-[14px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              data-slot="sheet-close"
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
            >
              <X aria-hidden="true" className="size-5" strokeWidth={2} />
              <span className="sr-only">{t("common.close")}</span>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 lg:px-6">{children}</div>
          {footer ? (
            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end lg:px-6 [&>*]:w-full sm:[&>*]:w-auto">
              {footer}
            </div>
          ) : (
            <div aria-hidden="true" className="pb-[env(safe-area-inset-bottom)]" />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
