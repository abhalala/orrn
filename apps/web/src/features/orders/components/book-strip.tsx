import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";

import { bpPercent1 } from "@orrn/domain";

import { type BookTotals } from "../book-view";
import { orderKgText } from "../format";

/**
 * The header strip of the order book (FP-OP-20): open orders, ordered, in stock (available only),
 * held (on a truck or for an order), dispatched and baki over the whole filter. Every figure is `totals` of the same `orders.list` answer the grid
 * is drawn from, so the strip is the sum of the grid; nothing here adds anything up.
 */
export function BookStrip({ totals, loading }: { totals: BookTotals | undefined; loading: boolean }) {
  const { t } = useT();
  if (!totals) {
    return loading ? <Skeleton className="h-24 w-full" /> : null;
  }
  const cells: { key: string; label: string; value: string; sub?: string; open?: boolean }[] = [
    { key: "orders", label: t("orders.book.strip.orders"), value: String(totals.openOrders), sub: t("orders.book.strip.ofShown", { count: totals.orders }) },
    { key: "ordered", label: t("orders.book.strip.ordered"), value: `${orderKgText(totals.orderedG)} ${t("units.kg")}` },
    {
      key: "inStock",
      label: t("orders.book.strip.inStock"),
      value: `${orderKgText(totals.inStockG)} ${t("units.kg")}`,
      sub: t("units.bundles", { count: totals.inStockBundles }),
    },
    {
      key: "held",
      label: t("orders.book.strip.held"),
      value: `${orderKgText(totals.heldG)} ${t("units.kg")}`,
      sub: t("units.bundles", { count: totals.heldBundles }),
    },
    {
      key: "dispatched",
      label: t("orders.book.strip.dispatched"),
      value: `${orderKgText(totals.dispatchedG)} ${t("units.kg")}`,
      sub: t("orders.book.bar.dispatchedPct", { pct: bpPercent1(totals.dispatchedBp) }),
    },
    { key: "baki", label: t("orders.book.strip.baki"), value: `${orderKgText(totals.bakiG)} ${t("units.kg")}`, open: totals.bakiG > 0 },
  ];
  return (
    <section aria-label={t("orders.book.strip.label")} className="flex min-w-0 flex-col gap-2">
      <dl data-book-strip="" className="m-0 grid grid-cols-2 gap-2 lg:grid-cols-6">
        {cells.map((c) => (
          <div
            key={c.key}
            data-book-total={c.key}
            className={cn("min-w-0 rounded-card px-3 py-3", c.open ? "bg-tone-amber-tint text-tone-amber-ink" : "bg-surface-sunken text-foreground", c.key === "baki" && "col-span-2 lg:col-span-1")}
          >
            <dt className={cn("m-0 text-xs font-medium", c.open ? "text-tone-amber-ink" : "text-muted-foreground")}>{c.label}</dt>
            <dd className="m-0 mt-1 font-mono text-[15px] leading-5 font-semibold tabular-nums break-words sm:text-base">{c.value}</dd>
            {c.sub ? <dd className={cn("m-0 text-[13px] tabular-nums", c.open ? "text-tone-amber-ink" : "text-muted-foreground")}>{c.sub}</dd> : null}
          </div>
        ))}
      </dl>
      {totals.lateOrders > 0 ? (
        <div>
          <Chip tone="red" truncate={false} data-book-late="">
            {t("orders.book.strip.late", { count: totals.lateOrders })}
          </Chip>
        </div>
      ) : null}
    </section>
  );
}
