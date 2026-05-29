import { OrrnUiProvider } from "@orrn/ui";
import { Toaster } from "@orrn/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
  useLocation,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { StaffShell } from "@orrn/web-shared/components/staff-shell";
import { TenantCacheGuard } from "@orrn/web-shared/components/tenant-cache-guard";
import { ThemeProvider } from "@orrn/web-shared/components/theme-provider";
import type { trpc } from "@orrn/web-shared/utils/trpc";
import "@orrn/web-shared/index.css";
import "../index.css";

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

function isPublicPath(pathname: string): boolean {
  return pathname === "/";
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [{ title: "ORRN — Staff console" }],
    links: [{ rel: "icon", href: "/favicon.ico" }],
  }),
});

function RootComponent() {
  const location = useLocation();
  const isPublic = isPublicPath(location.pathname);

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
          {isPublic ? (
            <Outlet />
          ) : (
            <StaffShell>
              <Outlet />
            </StaffShell>
          )}
          <Toaster richColors />
        </OrrnUiProvider>
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
