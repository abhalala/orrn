import { useT, type MessageKey } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";

const BUNDLE_STATUSES = [
  "status.bundle.available",
  "status.bundle.reserved",
  "status.bundle.dispatched",
] as const satisfies readonly MessageKey[];

export function Wordmark({ className, onInk = false }: { className?: string; onInk?: boolean }) {
  const { t } = useT();
  return (
    <Link
      to="/"
      aria-label={t("nav.home")}
      className={cn("inline-flex min-h-11 items-center gap-2.5 rounded-full pr-2 no-underline", className)}
    >
      <span aria-hidden="true" className="orrn-mark size-8" />
      <span
        className={cn(
          "font-sans text-[22px] font-semibold tracking-[-0.035em]",
          onInk ? "text-tone-neutral-on" : "text-foreground",
        )}
      >
        {t("common.appName")}
      </span>
    </Link>
  );
}

/** Laptop front door: existing brand copy and the real Today screen, in the app's theme. */
export function BrandPanel({ className }: { className?: string }) {
  const { t, locale } = useT();
  return (
    <aside
      aria-label={t("auth.brand.label")}
      className={cn("min-w-0 bg-background p-4 font-sans text-foreground xl:p-6", className)}
    >
      <div className="flex h-full min-h-0 flex-col gap-8 overflow-y-auto rounded-2xl border border-border bg-card p-6 xl:p-8">
        <Wordmark className="self-start" />
        <div className="flex flex-1 flex-col justify-center gap-7 py-4">
          <div className="flex max-w-[32rem] flex-col gap-4">
            <p
              className={cn(
                "m-0 max-w-[16ch] text-[36px] font-semibold leading-[1.15] tracking-[-0.035em] text-balance xl:text-[46px]",
                locale !== "en" && "leading-[1.3] tracking-normal",
              )}
            >
              {t("auth.brand.headline")}
            </p>
            <p className="m-0 max-w-[42ch] text-[16px] leading-7 text-muted-foreground">
              {t("auth.brand.sub")}
            </p>
          </div>
          <figure aria-hidden="true" className="m-0 flex min-w-0 flex-col gap-3">
            <div className="overflow-hidden rounded-xl border border-border bg-background">
              {/* The app class controls both images, including manual theme overrides. */}
              <img
                src="/marketing/owner-today-1440.webp"
                alt=""
                width={2880}
                height={1800}
                loading="lazy"
                decoding="async"
                className="block h-auto w-full dark:hidden"
              />
              <img
                src="/marketing/owner-today-dark-1440.webp"
                alt=""
                width={2880}
                height={1800}
                loading="lazy"
                decoding="async"
                className="hidden h-auto w-full dark:block"
              />
            </div>
            <figcaption className="text-[13px] leading-5 text-muted-foreground">
              {t("common.demoData")}
            </figcaption>
          </figure>
        </div>
      </div>
    </aside>
  );
}

/**
 * Phone and tablet: a quiet status strip above the form. Decorative, with no arrival motion.
 */
export function BrandStrip({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <div
      aria-hidden="true"
      className={cn("grid grid-cols-3 rounded-xl border border-border bg-card font-sans", className)}
    >
      {BUNDLE_STATUSES.map((status) => (
        <span
          key={status}
          className="flex min-w-0 items-center justify-center px-2 py-3 text-center text-[13px] leading-5 font-medium break-words text-muted-foreground [&+span]:border-l [&+span]:border-border"
        >
          {t(status)}
        </span>
      ))}
    </div>
  );
}
