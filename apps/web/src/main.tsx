import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "@/shared/components/loader";
import { routeTree } from "./routeTree.gen";
import { queryClient, trpc } from "@/shared/utils/trpc";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
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
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  },
});

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
