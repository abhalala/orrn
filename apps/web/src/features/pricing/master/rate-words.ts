/** Words for a price row, in the person's language: its name and how its rate is quoted. */
import type { Translate } from "@orrn/i18n";

import { rateTitle, rateUnit, type RateItem } from "./rate-model";

export function rateName(t: Translate, item: RateItem): string {
  const title = rateTitle(item);
  switch (title.type) {
    case "metal":
      return t(`price.master.names.metal.${title.source}`);
    case "conversionDefault":
      return t("price.master.names.conversionDefault");
    case "conversionSeries":
      return t("price.master.names.conversionSeries", { series: title.series });
    case "conversionDie":
      return t("price.master.names.conversionDie", { code: title.code });
    case "plain":
      return title.text;
    case "customer":
      return t(`price.master.names.customer.${title.mode}`, { name: title.name });
  }
}

/** "₹205.50 per kg" (per piece or per order for an add-on); `rate` is already formatted rupees. */
export function rateQuoted(t: Translate, item: RateItem, rate: string): string {
  const unit = rateUnit(item);
  return t(unit === "kg" ? "price.master.perKg" : unit === "piece" ? "price.master.perPiece" : "price.master.perOrder", { rate });
}
