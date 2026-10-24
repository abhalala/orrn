import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";

/**
 * Sections | Bundles: the two Stock views (spec §3 Stock). They are two
 * pages, so this is a pair of links with `aria-current`, drawn like the C2
 * segmented control. Links, not a radio group: switching loads a page.
 */
export function StockViewSwitch({ current }: { current: "sections" | "bundles" }) {
  const { t } = useT();
  const items = [
    { key: "sections", to: "/stock", label: t("stock.sections") },
    { key: "bundles", to: "/stock/bundles", label: t("stock.bundles") },
  ] as const;
  return (
    <nav aria-label={t("stock.view")} className="flex">
      <ul className="m-0 flex w-full list-none rounded-full bg-surface-sunken p-1 sm:w-auto dark:bg-background dark:ring-1 dark:ring-border">
        {items.map((item) => {
          const active = item.key === current;
          return (
            <li key={item.key} className="flex min-w-0 flex-1 sm:flex-none">
              <Link
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "animate-press inline-flex h-11 w-full min-w-0 items-center justify-center rounded-full px-5 text-[15px] font-semibold whitespace-nowrap no-underline transition-[color,background-color,scale] duration-[var(--dur-fast)]",
                  active
                    ? "bg-card text-foreground shadow-sm dark:bg-surface-sunken dark:ring-1 dark:ring-control/40"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
