import { I18nProvider } from "@orrn/i18n";
import { LinkProvider } from "@orrn/ui/components/link";
import { Toaster } from "@orrn/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { Suspense, lazy, useState } from "react";

import { NavigationProgress } from "@/shared/components/navigation-progress";
import { RootNotFound } from "@/shared/components/not-found";
import { RouterLink } from "@/shared/components/router-link";
import { TenantCacheGuard } from "@/shared/components/tenant-cache-guard";
import { THEME_STORAGE_KEY, ThemeColorSync, ThemeProvider } from "@/shared/components/theme-provider";
import { readStoredLocale, storeLocale } from "@/shared/lib/locale";
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
      { title: "ORRN: multi-company ERP for manufactured inventory ops" },
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
  // Read once per load; the toggle updates the provider and storage together.
  const [locale] = useState(readStoredLocale);
  return (
    <>
      <HeadContent />
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        storageKey={THEME_STORAGE_KEY}
      >
        <I18nProvider locale={locale} onLocaleChange={storeLocale}>
          <ThemeColorSync />
          <NavigationProgress />
          <TenantCacheGuard />
          {/* @orrn/ui links (tiles, list rows, back links) navigate through the router. */}
          <LinkProvider component={RouterLink}>
            <Outlet />
          </LinkProvider>
          <Toaster richColors />
        </I18nProvider>
      </ThemeProvider>
      {/* Devtools stay out of automated runs (Playwright sets navigator.webdriver)
          so visual snapshots and axe only see product UI. */}
      {import.meta.env.DEV && !navigator.webdriver ? (
        <Suspense fallback={null}>
          <TanStackRouterDevtools position="bottom-left" />
          <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        </Suspense>
      ) : null}
    </>
  );
}
