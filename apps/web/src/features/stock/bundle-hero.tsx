import { bundleTone, type BundleStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Ban, ChevronRight, Lock, PackageCheck, Truck, type LucideIcon } from "lucide-react";

const STATUS_ICON: Record<BundleStatus, LucideIcon> = {
  available: PackageCheck,
  reserved: Lock,
  dispatched: Truck,
  void: Ban,
};

/**
 * The bundle page's one loud element (spec §3 `/b/:serial`): a hero block in
 * the status colour with the status word and icon, the bundle number in
 * Bricolage as the page's `h1`, and the section. A held or dispatched bundle
 * links to its dispatch from the block.
 */
export function BundleHero({
  serial,
  status,
  section,
  dieName,
  dispatch,
}: {
  serial: string;
  status: BundleStatus;
  section: string | null;
  dieName: string | null;
  dispatch: { id: string; code: string } | null;
}) {
  const { t } = useT();
  const tone = bundleTone(status);
  const Icon = STATUS_ICON[status];
  const sub = [section, dieName].filter(Boolean).join(" · ");

  return (
    <section
      data-testid="bundle-hero"
      data-status={status}
      className={cn(
        "orrn-block orrn-block-hero orrn-block-sheen animate-rise flex min-w-0 flex-col gap-6 p-5 sm:p-7",
        `orrn-block-${tone}`,
      )}
    >
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 inline-flex items-center gap-2 text-[15px] font-bold leading-6" data-testid="bundle-status">
          <Icon aria-hidden="true" strokeWidth={2} className="size-5 shrink-0" />
          {t(`status.bundle.${status}`)}
        </p>
        {dispatch ? (
          <Link
            to="/dispatch/$id"
            params={{ id: dispatch.id }}
            className="animate-press inline-flex min-h-11 items-center gap-1 rounded-full border border-current/45 bg-black/10 py-1.5 pr-2.5 pl-4 text-[15px] font-semibold text-inherit no-underline transition-[background-color,scale] duration-[var(--dur-fast)] hover:bg-black/18 focus-visible:outline-current"
          >
            <span className="min-w-0 break-words">{t("bundle.inDispatch", { code: dispatch.code })}</span>
            <ChevronRight aria-hidden="true" strokeWidth={2} className="size-5 shrink-0" />
          </Link>
        ) : null}
      </div>
      <div className="relative min-w-0">
        <h1 className="m-0 font-display text-[44px] font-extrabold leading-[0.95] tracking-[-0.04em] tabular-nums [overflow-wrap:anywhere] sm:text-[60px]">
          <span className="sr-only">{t("bundle.title", { serial })}</span>
          <span aria-hidden="true" data-testid="bundle-serial">
            {serial}
          </span>
        </h1>
        {sub ? <p className="m-0 mt-3 text-[16px] font-semibold leading-snug break-words">{sub}</p> : null}
      </div>
    </section>
  );
}
