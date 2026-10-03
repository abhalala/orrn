// C2 type, self-hosted (no font CDN at runtime): Bricolage Grotesque for
// display (with its optical-size axis), Geist for UI, Geist Mono for numbers.
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { Button } from "@orrn/ui/components/button";
import { NotFoundPage } from "@orrn/ui/components/not-found";
import { QueryClientProvider } from "@tanstack/react-query";
import { Link, RouterProvider, createRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import ReactDOM from "react-dom/client";

import Loader from "@/shared/components/loader";
import { routeTree } from "./routeTree.gen";
import { queryClient, registerSessionEndedHandler, trpc } from "@/shared/utils/trpc";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultNotFoundComponent: WebNotFoundPage,
  notFoundMode: "root",
  defaultPendingComponent: () => <Loader />,
  /**
   * Enable the browser View Transitions API for cross-fading between routes
   * (Chrome 111+, Edge, Opera). CSS handles the actual fade — see
   * `::view-transition-old(root)` and `::view-transition-new(root)` in
   * `packages/ui/src/styles/globals.css`. Older browsers fall back to no-op.
   */
  defaultViewTransition: true,
  /**
   * Render a pending component only when a route loader takes longer than
   * 300ms. Below that, navigation feels instant and we just rely on the top
   * NProgress bar + view-transition fade — no flashing skeletons for cached
   * data or fast networks.
   */
  defaultPendingMs: 300,
  defaultPendingMinMs: 250,
  context: { trpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  },
});

/** Layouts that sit behind a session guard; anything else (public pages, 404) never bounces to login. */
const GUARDED_LAYOUTS = new Set(["/_tenant", "/_platform", "/_authed"]);

/**
 * The session ended mid-use (UNAUTHORIZED from any query or mutation): go to
 * /login and come back to this page afterwards. Only acts on a page rendered
 * inside a guarded layout (derived from the route match, no hand-kept path
 * list), and not while a navigation is pending (the route guard answers that
 * one itself with its own redirect), so it can never fight a guard into a loop.
 */
let leavingForLogin = false;
registerSessionEndedHandler(() => {
  if (leavingForLogin || router.state.status === "pending") return;
  if (!router.state.matches.some((m) => GUARDED_LAYOUTS.has(m.routeId))) return;
  const { href } = router.state.location;
  leavingForLogin = true;
  void router
    .navigate({ to: "/login", search: { next: href }, replace: true })
    .then(() => queryClient.clear())
    .finally(() => {
      leavingForLogin = false;
    });
});

function WebNotFoundPage() {
  return (
    <NotFoundPage
      primaryAction={
        <Button asChild size="lg">
          <Link to="/">Go to ORRN home</Link>
        </Button>
      }
      secondaryAction={
        <Button asChild size="lg" variant="outline">
          <Link to="/login">Sign in</Link>
        </Button>
      }
    />
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RouterProvider router={router} />);
}
