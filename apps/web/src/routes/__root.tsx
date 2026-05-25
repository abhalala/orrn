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

import { AppShell } from "@/components/app-shell";
import { TenantCacheGuard } from "@/components/tenant-cache-guard";
import { ThemeProvider } from "@/components/theme-provider";
import type { trpc } from "@/utils/trpc";

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

/**
 * Routes whose URL starts with one of these prefixes are PUBLIC and rendered
 * outside the authenticated AppShell. Keep this in sync with the file routes
 * that DO NOT use `requireCompanyMe` / `requirePlatformAdmin` in beforeLoad.
 */
const PUBLIC_PATH_PREFIXES = ["/login", "/waitlist", "/invite", "/no-access"] as const;
function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function RootComponent() {
  const location = useLocation();
  const isPublic = isPublicPath(location.pathname);
  const isHome = location.pathname === "/";

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
            <div className="relative min-h-screen w-full bg-background flex flex-col justify-between overflow-x-hidden">
              {/* Global Background Gradient Mesh for all public routes */}
              <div className="absolute inset-0 -z-10 overflow-hidden">
                <div className="absolute left-[15%] top-[-10%] h-[600px] w-[600px] rounded-full bg-gradient-to-tr from-[#5b6cff]/10 to-[#22d3ee]/5 blur-[120px]" />
                <div className="absolute right-[5%] top-[20%] h-[500px] w-[500px] rounded-full bg-gradient-to-br from-[#22d3ee]/8 to-[#3b4edd]/10 blur-[100px]" />
              </div>
              {isHome ? (
                <div className="w-full">
                  <Outlet />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center p-4">
                  <Outlet />
                </div>
              )}
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
