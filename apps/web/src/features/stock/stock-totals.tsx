import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Skeleton } from "@orrn/ui/components/skeleton";

type Kind = { bundles: number; pcs: number; weightG: number };

/**
 * The totals of the filter on screen, counted by the server (never summed from the page shown):
 * bundles, pieces and kg, then hollow / solid / semi when the sections have a kind set (FP-PK-08).
 */
export function StockTotals({
  totals,
  kinds,
  loading,
}: {
  totals?: { bundles: number; pcs?: number; weightG: number };
  kinds?: Record<"hollow" | "solid" | "semi" | "none", Kind>;
  loading: boolean;
}) {
  const { t } = useT();
  if (loading || !totals) return <Skeleton className="h-6 w-72" />;
  const shown = (["hollow", "solid", "semi"] as const).filter((k) => (kinds?.[k].bundles ?? 0) > 0);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="stock-totals">
      <p className="m-0 text-[15px] leading-6 text-muted-foreground tabular-nums" data-testid="stock-totals-line">
        {t("stock.totals", { bundles: totals.bundles.toLocaleString("en-IN"), kg: formatKgTotal(gToKg(totals.weightG)) })}
        {totals.pcs != null ? ` · ${totals.pcs.toLocaleString("en-IN")} ${t("units.pcs")}` : ""}
      </p>
      {shown.length > 0 ? (
        <ul aria-label={t("stock.filters.kind")} className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="stock-kind-totals">
          {shown.map((k) => (
            <li
              key={k}
              data-kind={k}
              className="rounded-full border border-border bg-card px-3 py-1 text-[13px] font-medium tabular-nums"
            >
              {t(`packingList.v2.summary.${k}`)}: {t("stock.totals", { bundles: kinds![k].bundles.toLocaleString("en-IN"), kg: formatKgTotal(gToKg(kinds![k].weightG)) })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
