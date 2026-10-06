import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";

/**
 * The visible "Demo data" micro-label every product picture on the marketing
 * page carries (no invented metrics: the numbers in the pictures are
 * examples). The pictures themselves are `aria-hidden`, so this is for
 * sighted readers. `onColor` is for use on a status block.
 */
export function DemoLabel({ onColor = false, className }: { onColor?: boolean; className?: string }) {
  const { t } = useT();
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full px-2.5 text-[12px] font-semibold leading-none",
        onColor ? "bg-tone-neutral-to/25 text-tone-neutral-on" : "bg-surface-sunken text-ink-muted",
        className,
      )}
    >
      {t("common.demoData")}
    </span>
  );
}
