import { Button } from "@orrn/ui/components/button";
import { Link } from "@tanstack/react-router";
import { Compass, SearchX } from "lucide-react";

/**
 * Full-page 404 for unmatched URLs outside any app shell. Brand-gradient
 * backdrop, oversized glyph, links back to safety.
 */
export function RootNotFound() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-4 text-center text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(55% 45% at 50% 0%, color-mix(in srgb, var(--brand-500) 13%, transparent), transparent 70%), radial-gradient(60% 50% at 50% 110%, color-mix(in srgb, var(--brand-accent) 8%, transparent), transparent 70%)",
        }}
      />
      <div className="relative z-10 flex max-w-md animate-in fade-in-0 slide-in-from-bottom-2 flex-col items-center gap-5 duration-500 ease-out">
        <p
          className="orrn-gradient-text m-0 select-none text-[clamp(5rem,18vw,9rem)] font-bold leading-none tracking-tight"
          aria-hidden="true"
        >
          404
        </p>
        <div className="space-y-2">
          <h1 className="m-0 text-xl font-semibold tracking-[-0.015em]">
            This page doesn't exist
          </h1>
          <p className="m-0 text-sm leading-6 text-muted-foreground">
            The link may be outdated, or the page may have moved. Head back home or sign in to
            your workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link to="/" className="no-underline">
            <Button>
              <Compass size={16} aria-hidden="true" /> Back to home
            </Button>
          </Link>
          <Link to="/login" className="no-underline">
            <Button variant="outline">Sign in</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}

/**
 * In-shell not-found state for `_tenant` / `_platform` layouts. Renders inside
 * the workspace shell so users keep their navigation, with links back to the
 * surface's home. Also used for missing/foreign-tenant entity ids (generic
 * "Not found" — never reveals cross-tenant existence).
 */
export function WorkspaceNotFound({
  homePath,
  homeLabel,
}: {
  homePath: string;
  homeLabel: string;
}) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center gap-5 px-4 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <SearchX size={26} aria-hidden="true" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="m-0 text-lg font-semibold tracking-[-0.015em] text-foreground">
          Not found in this workspace
        </h1>
        <p className="m-0 text-sm leading-6 text-muted-foreground">
          The page or record you're looking for doesn't exist here. It may have been removed, or
          the link may be incorrect.
        </p>
      </div>
      <Link to={homePath as "/"} className="no-underline">
        <Button variant="outline">Back to {homeLabel}</Button>
      </Link>
    </div>
  );
}
