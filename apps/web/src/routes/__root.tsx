import { OrrnUiProvider } from "@orrn/ui";
import { Toaster } from "@orrn/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { TenantCacheGuard } from "@orrn/web-shared/components/tenant-cache-guard";
import { ThemeProvider } from "@orrn/web-shared/components/theme-provider";
import type { trpc } from "@orrn/web-shared/utils/trpc";
import "@orrn/web-shared/index.css";
import "../index.css";

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      { title: "ORRN — multi-company ERP for manufactured inventory ops" },
      {
        name: "description",
        content:
          "ORRN is a multi-company ERP for manufactured inventory operations: dies, bundles, dispatches, printing, and audit.",
      },
    ],
    links: [{ rel: "icon", href: "/favicon.ico" }],
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
        <OrrnUiProvider defaultTheme="dark">
          <TenantCacheGuard />
          <div className="relative min-h-screen w-full bg-background flex flex-col overflow-x-hidden">
            <div className="absolute inset-0 -z-10 overflow-hidden">
              <div className="absolute left-[15%] top-[-10%] h-[600px] w-[600px] rounded-full bg-gradient-to-tr from-[#5b6cff]/10 to-[#22d3ee]/5 blur-[120px]" />
              <div className="absolute right-[5%] top-[20%] h-[500px] w-[500px] rounded-full bg-gradient-to-br from-[#22d3ee]/8 to-[#3b4edd]/10 blur-[100px]" />
            </div>
            <Outlet />
          </div>
          <Toaster richColors />
        </OrrnUiProvider>
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
