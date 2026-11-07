import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";

import { usePageTitle } from "@/features/auth/use-page-title";
import { SkipLink } from "@/shell/skip-link";

/** Public 404: the homepage's flat canvas, brand and two routes back. */
export function RootNotFound() {
  const { t, locale } = useT();
  usePageTitle(`404 | ${t("marketing.notFound.title")}`);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background font-sans text-foreground">
      <SkipLink />
      <header className="border-b border-border px-4 py-3 sm:px-8">
        <div className="mx-auto w-full max-w-[1200px]">
          {/* Keep the root's brand in public copy; the auth panel also names private keys. */}
          <Link
            to="/"
            aria-label={t("marketing.homeLabel")}
            className="inline-flex min-h-11 items-center gap-2.5 rounded-full pr-2 no-underline"
          >
            <span aria-hidden="true" className="orrn-mark size-8" />
            <span className="text-[22px] font-semibold tracking-[-0.035em]">
              {t("common.appName")}
            </span>
          </Link>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-4 py-12 sm:px-8 sm:py-20"
      >
        <div className="w-full max-w-[560px] rounded-2xl border border-border bg-card p-6 sm:p-10">
          <p className="m-0 text-[14px] leading-6 font-medium text-muted-foreground">404</p>
          <h1
            className={cn(
              "mt-5 mb-0 font-sans text-[32px] font-semibold leading-[1.2] tracking-[-0.03em] text-balance sm:text-[40px]",
              locale !== "en" && "leading-[1.3] tracking-normal",
            )}
          >
            {t("marketing.notFound.title")}
          </h1>
          <p className="mt-4 mb-0 max-w-[42ch] text-[16px] leading-7 text-muted-foreground">
            {t("marketing.notFound.body")}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild className="h-auto min-h-11 whitespace-normal py-3 text-center shadow-none">
              <Link to="/">{t("marketing.notFound.backHome")}</Link>
            </Button>
            <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-3 text-center shadow-none">
              <Link to="/login">{t("marketing.signIn")}</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
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
