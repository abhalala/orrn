import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { IndianRupee } from "lucide-react";

import { Can } from "@/shared/components/can";

import { valueCardModel, type DispatchValue } from "./value-view";

/**
 * FP-OP-14: the value of a dispatch from the rate on each order line (server-computed, weighed kg).
 * Shown only when the server sends `value` (priceOnSalesOrder on and `order.price` held). Bundles
 * whose line has no rate are named, never priced at zero. Not a tax invoice.
 */
export function ValueCard({ value }: { value: DispatchValue | null | undefined }) {
  const { t } = useT();
  const model = valueCardModel(value);
  if (!model) return null;
  return (
    <Can do="order.price">
      <section
        data-testid="dispatch-value"
        aria-labelledby="dispatch-value-title"
        className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card px-4 py-3"
      >
        <h2 id="dispatch-value-title" className="m-0 flex items-center gap-2 text-[14px] font-semibold text-muted-foreground">
          <IndianRupee aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
          {t("dispatch.value.title")}
        </h2>
        <p className="m-0 font-mono text-[22px] font-semibold tabular-nums" data-testid="dispatch-value-amount" data-no-truncate="">
          {model.amount}
        </p>
        <p className="m-0 text-[14px] text-muted-foreground">{t("dispatch.value.priced", { kg: model.pricedKg })}</p>
        <p
          className={cn("m-0 text-[14px]", model.missing ? "font-semibold text-tone-amber-ink" : "text-muted-foreground")}
          data-testid="dispatch-value-missing"
        >
          {model.missing ? t("dispatch.value.missing", { count: model.missing.count, kg: model.missing.kg }) : t("dispatch.value.complete")}
        </p>
        <p className="m-0 text-[13px] text-muted-foreground">{t("dispatch.value.note")}</p>
      </section>
    </Can>
  );
}
