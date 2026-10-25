import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/casts` has no list of its own yet (the foundry screens are paused, D27): it opens the spectro
 * inbox, the one cast screen that is live, instead of a 404 (owner walk-through M6, BACKLOG 97).
 */
export const Route = createFileRoute("/_tenant/casts/")({
  beforeLoad: () => {
    throw redirect({ to: "/casts/inbox", replace: true });
  },
});
