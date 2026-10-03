import { Button } from "@orrn/ui/components/button";
import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";

/**
 * Full-page 404 for unmatched URLs outside any app shell. Flat C2 canvas,
 * a big display "404", links back to safety.
 */
export function RootNotFound() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-4 text-center text-foreground">
      <div className="orrn-rise flex max-w-md flex-col items-center gap-6">
        <p
          className="m-0 select-none font-display text-[clamp(5rem,18vw,9rem)] font-extrabold leading-none tracking-[-0.05em] text-foreground"
          aria-hidden="true"
        >
          404
        </p>
        <div className="space-y-2">
          <h1 className="m-0 font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em]">
            This page doesn't exist
          </h1>
          <p className="m-0 text-[15px] leading-6 text-muted-foreground">
            The link may be outdated, or the page may have moved. Head back home or sign in to
            your workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/">Back to home</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

/**
 * In-shell not-found state for `_tenant` / `_platform` layouts. Renders inside
 * the workspace shell so users keep their navigation, with links back to the
 * surface's home. Also used for missing/foreign-tenant entity ids (generic
 * "Not found", never reveals cross-tenant existence).
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
      <div
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-card bg-surface-sunken text-foreground"
      >
        <SearchX size={26} aria-hidden="true" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="m-0 font-display text-2xl font-extrabold tracking-[-0.03em] text-foreground">
          Not found in this workspace
        </h1>
        <p className="m-0 text-[15px] leading-6 text-muted-foreground">
          The page or record you're looking for doesn't exist here. It may have been removed, or
          the link may be incorrect.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to={homePath as "/"}>Back to {homeLabel}</Link>
      </Button>
    </div>
  );
}
