import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * Shared backdrop for auth and onboarding flows: brand-gradient wash with a
 * subtle grid, ORRN wordmark up top, and a centered content well. Children
 * (cards/forms) sit on top of the gradient — pair with `Card` for the glass
 * look.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-svh w-full flex-col items-center overflow-hidden bg-background px-4 py-8 text-foreground">
      {/* Brand gradient backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 20% 0%, color-mix(in srgb, var(--brand-500) 14%, transparent), transparent 70%), radial-gradient(50% 45% at 85% 10%, color-mix(in srgb, var(--brand-accent) 9%, transparent), transparent 70%), radial-gradient(70% 60% at 50% 110%, color-mix(in srgb, var(--brand-600) 10%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in srgb, var(--border) 55%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--border) 55%, transparent) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(70% 60% at 50% 30%, black, transparent)",
        }}
      />

      <header className="relative z-10 flex w-full max-w-5xl items-center justify-between py-2">
        <Link to="/" className="flex items-center gap-2 no-underline" aria-label="ORRN home">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            O
          </div>
          <span className="text-base font-semibold text-foreground">ORRN</span>
        </Link>
        <Link
          to="/"
          className="text-xs font-medium text-muted-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:text-foreground"
        >
          ← Back to home
        </Link>
      </header>

      <div className="relative z-10 flex w-full flex-1 flex-col items-center justify-center py-6">
        <div className="orrn-auth-card flex w-full animate-in fade-in-0 slide-in-from-bottom-2 flex-col items-center duration-500 ease-out">
          {children}
        </div>
      </div>

      <footer className="relative z-10 py-2 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} ORRN · Tenant-isolated ERP for manufactured inventory
      </footer>
    </main>
  );
}
