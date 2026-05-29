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

import { AppShell } from "@orrn/web-shared/components/app-shell";
import { TenantCacheGuard } from "@orrn/web-shared/components/tenant-cache-guard";
import { ThemeProvider } from "@orrn/web-shared/components/theme-provider";
import type { trpc } from "@orrn/web-shared/utils/trpc";
import "@orrn/web-shared/index.css";
import "../index.css";

export interface RouterAppContext {
  trpc: typeof trpc;
  queryClient: QueryClient;
}

const PUBLIC_PATH_PREFIXES = [
  "/no-access",
  "/onboarding",
  "/invite",
  "/setup-credentials",
  "/change-password",
] as const;

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      { title: "ORRN — ERP" },
      {
        name: "description",
        content: "ORRN tenant ERP for manufactured inventory operations.",
      },
    ],
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
            <div className="relative min-h-screen w-full bg-background flex flex-col items-center justify-center p-4">
              <Outlet />
            </div>
          ) : (
            <AppShell>
              <Outlet />
            </AppShell>
          )}
          <Toaster richColors />
        </OrrnUiProvider>
      </ThemeProvider>
      <TanStackRouterDevtools position="bottom-left" />
      <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
    </>
  );
}
