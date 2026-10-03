import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Shared frame for auth and onboarding flows (C2): flat warm canvas, the
 * orrn wordmark up top, and a centred content well. Children are usually a
 * `Card` (white surface, 16px radius) holding the form.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] w-full flex-col items-center bg-background px-4 pb-6 pt-4 text-foreground sm:px-6">
      <header className="flex w-full max-w-5xl items-center justify-between gap-4">
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2.5 rounded-full pr-2 no-underline"
          aria-label="ORRN home"
        >
          <span aria-hidden="true" className="orrn-mark size-8" />
          <span className="font-display text-[22px] font-extrabold tracking-[-0.03em] text-foreground">
            orrn
          </span>
        </Link>
        <Link
          to="/"
          className="inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium text-muted-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-accent hover:text-foreground"
        >
          Back to home
        </Link>
      </header>

      <div className="flex w-full flex-1 flex-col items-center justify-center py-6 sm:py-10">
        <div className="orrn-auth-card orrn-rise flex w-full flex-col items-center">{children}</div>
      </div>

      <footer className="py-2 text-center text-[13px] text-muted-foreground">
        © {new Date().getFullYear()} ORRN · Tenant-isolated ERP for manufactured inventory
      </footer>
    </main>
  );
}
