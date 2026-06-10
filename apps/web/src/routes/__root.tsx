import { Toaster } from "@orrn/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { NavigationProgress } from "@/shared/components/navigation-progress";
import { RootNotFound } from "@/shared/components/not-found";
import { ThemeProvider } from "@/shared/components/theme-provider";
import type { trpc } from "@/shared/utils/trpc";
import "../index.css";

const ReactQueryDevtools = lazy(async () => {
  const { ReactQueryDevtools } = await import("@tanstack/react-query-devtools");
  return { default: ReactQueryDevtools };
});

const TanStackRouterDevtools = lazy(async () => {
  const { TanStackRouterDevtools } = await import(
    "@tanstack/react-router-devtools"
  );
  return { default: TanStackRouterDevtools };
});

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  notFoundComponent: RootNotFound,
  head: () => ({
    meta: [
      { title: "ORRN — multi-company ERP for manufactured inventory ops" },
      {
        name: "description",
        content:
          "ORRN is a multi-company ERP for manufactured inventory operations: dies, bundles, dispatches, printing, and audit.",
      },
    ],
    links: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
  }),
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
        storageKey="vite-ui-theme"
      >
        <NavigationProgress />
        <Outlet />
        <Toaster richColors />
      </ThemeProvider>
      {import.meta.env.DEV ? (
        <Suspense fallback={null}>
          <TanStackRouterDevtools position="bottom-left" />
          <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        </Suspense>
      ) : null}
    </>
  );
}
