import { type Fmt } from "@orrn/domain";

import { sectionText, sectionUnit } from "@/shared/lib/fmt-text";

/**
 * A copy's band as the copies list shows it. `bandText` is the server's kg per 12 ft text ("2.300-2.500") or the band's
 * own label; it says nothing about the plant's section unit, so the figures come from the band's ends in grams per
 * 12 ft and are written by the plant formatter, with the plant's unit word. A label is a name a person typed and is kept.
 */
export function copyBandCell(c: { bandText: string; bandMinG?: number | null; bandMaxG?: number | null }, fmt: Fmt): string {
  if (!/^\d/.test(c.bandText)) return c.bandText;
  if (c.bandMinG == null || c.bandMaxG == null) return `${c.bandText} ${sectionUnit(fmt)}`;
  return `${sectionText(fmt, c.bandMinG)}-${sectionText(fmt, c.bandMaxG)} ${sectionUnit(fmt)}`;
}
