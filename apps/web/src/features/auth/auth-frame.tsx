import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";

import { LanguageToggle } from "@/shell/language-toggle";

import { BrandPanel, BrandStrip, Wordmark } from "./brand-panel";

export type AuthFrameProps = {
  children: ReactNode;
  /**
   * Show the brand: the ink panel on laptops (>= 1024px, split layout) and the
   * slim colour strip above the form on phones and iPads. For the public
   * pages (sign in, request access, invite). Signed-in chores (welcome,
   * no-access) keep the plain frame.
   */
  brand?: boolean;
  /** Content width: `form` (400px) for short forms, `wide` (560px) for longer ones. */
  width?: "form" | "wide";
  /** Quiet content under the main column (a sign-out link, a help line). */
  footer?: ReactNode;
};

/**
 * Frame for every front-door screen (C2): warm canvas, the orrn wordmark and
 * the language toggle on top (one tap to Hindi before signing in), one
 * centred column. On laptops with `brand`, the left half is the brand panel.
 *
 * DOM order is header, main, then the panel, so keyboard and screen-reader
 * users reach the form first; CSS puts the panel on the left.
 */
export function AuthFrame({ children, brand = false, width = "form", footer }: AuthFrameProps) {
  return (
    <div
      className={cn(
        "min-h-[100dvh] w-full bg-background text-foreground",
        brand && "lg:grid lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]",
      )}
    >
      <div className="flex min-h-[100dvh] min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 sm:px-6">
          <Wordmark className={cn(brand && "lg:invisible")} />
          <LanguageToggle className="w-auto shrink-0" />
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="flex w-full flex-1 flex-col items-center justify-center px-4 pt-4 pb-10 sm:px-6 sm:pt-6"
        >
          <div className={cn("flex w-full min-w-0 flex-col", width === "wide" ? "max-w-[560px]" : "max-w-[400px]")}>
            {brand ? <BrandStrip className="mb-8 lg:hidden" /> : null}
            {children}
          </div>
        </main>

        {footer ? (
          <div className="flex justify-center px-4 pb-6 sm:px-6">
            <div className={cn("w-full", width === "wide" ? "max-w-[560px]" : "max-w-[400px]")}>{footer}</div>
          </div>
        ) : null}
      </div>

      {brand ? <BrandPanel className="hidden lg:sticky lg:top-0 lg:order-first lg:flex lg:h-[100dvh] lg:flex-col" /> : null}
    </div>
  );
}
