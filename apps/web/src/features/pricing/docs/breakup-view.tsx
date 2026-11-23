import type { PriceBreakup } from "@orrn/domain";
import { useT } from "@orrn/i18n";

import { useFmt } from "@/shared/lib/fmt";
import { rateText, rupeeText } from "@/shared/lib/fmt-text";

/** One row per part of a line's rate: metal, conversion, alloy, finish, add-ons, discount, then the rate. Rupees per kg. */
export function BreakupView({ breakup }: { breakup: PriceBreakup }) {
  const { t } = useT();
  const fmt = useFmt();
  const rows: { key: string; label: string; value: string; strong?: boolean }[] = [
    { key: "metal", label: t("price.quotes.breakup.metal", { source: t(`price.quotes.breakup.source.${breakup.metal.source}`) }), value: rateText(fmt, breakup.metal.paisePerKg) },
    { key: "conversion", label: t("price.quotes.breakup.conversion"), value: rateText(fmt, breakup.conversion.paisePerKg) },
  ];
  if (breakup.alloy.paisePerKg > 0) rows.push({ key: "alloy", label: t("price.quotes.breakup.alloy", { alloy: breakup.alloy.alloy ?? "" }), value: rateText(fmt, breakup.alloy.paisePerKg) });
  if (breakup.finish.paisePerKg > 0) rows.push({ key: "finish", label: t("price.quotes.breakup.finish", { finish: breakup.finish.finish ?? "" }), value: rateText(fmt, breakup.finish.paisePerKg) });
  for (const c of breakup.components) rows.push({ key: `c-${c.key}`, label: t("price.quotes.breakup.component", { label: c.label }), value: rupeeText(fmt, c.totalPaise) });
  if (breakup.componentsPaisePerKg > 0) rows.push({ key: "components", label: t("price.quotes.breakup.addons"), value: rateText(fmt, breakup.componentsPaisePerKg) });
  if (breakup.discountPaisePerKg > 0) rows.push({ key: "discount", label: t("price.quotes.breakup.discount"), value: rateText(fmt, breakup.discountPaisePerKg) });
  if (breakup.fixedPaisePerKg != null) rows.push({ key: "fixed", label: t("price.quotes.breakup.fixed"), value: rateText(fmt, breakup.fixedPaisePerKg) });
  rows.push({ key: "final", label: t("price.quotes.breakup.rate"), value: rateText(fmt, breakup.finalPaisePerKg), strong: true });
  return (
    <dl data-breakup="" className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[14px] leading-5">
      {rows.map((r) => (
        <div key={r.key} className="col-span-2 grid grid-cols-subgrid">
          <dt className={r.strong ? "font-semibold" : "text-muted-foreground"}>{r.label}</dt>
          <dd className={`m-0 text-right font-mono tabular-nums ${r.strong ? "font-semibold" : ""}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
