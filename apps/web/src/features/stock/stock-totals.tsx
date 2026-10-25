import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { Skeleton } from "@orrn/ui/components/skeleton";

type Sum = { bundles: number; pcs: number; weightG: number };
type KindTotals = Record<"hollow" | "solid" | "semi" | "none", Sum>;

/** What the server answers for the filter on screen (`stock` of every stock procedure). */
export type StockPosition = { inStock: Sum; held: Sum; kindTotals: KindTotals };

const STATUSES = ["available", "reserved", "dispatched", "void"] as const;

/**
 * The stock figures of the filter on screen, counted by the server (never summed in the browser).
 * "In stock" is ONE thing on every tab: available bundles only (BACKLOG 16); held bundles (on a
 * dispatch, still in the yard) are their own chip; hollow / solid / semi are of what is in stock.
 * The Bundles tab also passes what its list shows (`listed`, every status it lists) and the count per
 * status, so "All" never reads as "in stock".
 */
export function StockTotals({
  stock,
  listed,
  byStatus,
  loading,
}: {
  stock?: StockPosition;
  listed?: Sum;
  byStatus?: Record<(typeof STATUSES)[number], Sum>;
  loading: boolean;
}) {
  const { t } = useT();
  if (loading || !stock) return <Skeleton className="h-6 w-72" />;
  const { inStock, held, kindTotals } = stock;
  const shown = (["hollow", "solid", "semi"] as const).filter((k) => kindTotals[k].bundles > 0);
  const kg = (g: number) => formatKgTotal(gToKg(g));
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="stock-totals">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <p
          className="m-0 text-[15px] leading-6 text-muted-foreground tabular-nums"
          data-testid="stock-totals-line"
          data-in-stock-g={inStock.weightG}
          data-in-stock-bundles={inStock.bundles}
        >
          {t("stock.totals", { bundles: inStock.bundles.toLocaleString("en-IN"), kg: kg(inStock.weightG) })}
          {` · ${inStock.pcs.toLocaleString("en-IN")} ${t("units.pcs")}`}
        </p>
        {held.bundles > 0 ? (
          <Chip tone="blue" data-testid="stock-held" data-held-g={held.weightG}>
            {t("stock.heldKg", { count: held.bundles.toLocaleString("en-IN"), kg: kg(held.weightG) })}
          </Chip>
        ) : null}
      </div>
      {listed ? (
        <p className="m-0 text-[14px] leading-6 text-muted-foreground tabular-nums" data-testid="stock-listed">
          {t("stock.listed", { bundles: listed.bundles.toLocaleString("en-IN"), kg: kg(listed.weightG) })}
          {byStatus
            ? STATUSES.filter((s) => byStatus[s].bundles > 0)
                .map((s) => ` · ${t(`status.bundle.${s}`)} ${byStatus[s].bundles.toLocaleString("en-IN")}`)
                .join("")
            : ""}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ul aria-label={t("stock.filters.kind")} className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="stock-kind-totals">
          {shown.map((k) => (
            <li
              key={k}
              data-kind={k}
              className="rounded-full border border-border bg-card px-3 py-1 text-[13px] font-medium tabular-nums"
            >
              {t(`packingList.v2.summary.${k}`)}: {t("stock.totals", { bundles: kindTotals[k].bundles.toLocaleString("en-IN"), kg: kg(kindTotals[k].weightG) })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
