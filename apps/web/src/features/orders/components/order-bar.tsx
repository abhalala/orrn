import { bpPercent1 } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";

import { orderKgText } from "../format";
import { BAR_TONE, barSegments, nothingPlanned, type Bar } from "../book-view";

/**
 * One order's kg bar (FP-OP-20): dispatched, in stock, pressed not packed, planned not pressed and
 * the rest, in that order, drawn from the server's `bar` (they add up to the ordered kg), with the
 * dispatched share written out ("6.7% dispatched", never a bare figure). Each segment that holds
 * kg is named under the bar so the colour is never the only signal. An order with nothing in
 * motion is a plain grey bar with its baki.
 */
export function OrderBar({ number, bar, orderedG, bakiG, compact = false }: { number: string; bar: Bar; orderedG: number; bakiG: number; compact?: boolean }) {
  const { t } = useT();
  const segments = barSegments(bar);
  const visible = segments.filter((s) => s.grams > 0);
  const idle = nothingPlanned(bar);
  const pct = bpPercent1(bar.dispatchedBp);
  const summary = [
    t("orders.book.bar.label", { number }),
    t("orders.book.bar.dispatchedPct", { pct }),
    ...visible.map((s) => `${t(s.labelKey)} ${orderKgText(s.grams)} ${t("units.kg")}`),
    ...(bar.overG > 0 ? [t("orders.book.bar.over", { kg: orderKgText(bar.overG) })] : []),
  ].join(", ");
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-order-bar={number}>
      <div
        role="img"
        aria-label={summary}
        className={cn("flex w-full overflow-hidden rounded-full border border-border bg-surface-sunken", compact ? "h-2.5" : "h-3")}
      >
        {idle || orderedG <= 0 ? null : segments.map((s) => (s.grams > 0 ? <span key={s.key} data-segment={s.key} data-kg={s.grams} className={cn("h-full", BAR_TONE[s.key])} style={{ flexGrow: s.grams, flexBasis: 0 }} /> : null))}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="m-0 text-[13px] font-semibold tabular-nums" data-bar-label="">
          {t("orders.book.bar.dispatchedPct", { pct })}
        </p>
        <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
          {idle ? `${t("orders.book.bar.nothingPlanned")} · ` : ""}
          {t("orders.book.bar.baki", { kg: orderKgText(bakiG) })}
        </p>
      </div>
      {idle && bar.overG === 0 ? null : (
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs text-muted-foreground">
          {visible
            .filter((s) => s.key !== "rest")
            .map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span aria-hidden="true" className={cn("size-2 rounded-sm", BAR_TONE[s.key])} />
                <span>{t(s.labelKey)}</span>
                <span className="font-mono tabular-nums text-foreground">{orderKgText(s.grams)}</span>
              </li>
            ))}
          {bar.overG > 0 ? (
            <li className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-tone-red-ink" data-bar-over="">
              {t("orders.book.bar.over", { kg: orderKgText(bar.overG) })}
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
