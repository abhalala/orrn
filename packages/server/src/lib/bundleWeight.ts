import { kgPer12ft } from "@orrn/domain";

/** kg per 12 ft × 1000 as stored on `bundle.kg_per_12ft_milli` (null when pieces or length are missing). */
export function kgPer12ftMilli(row: { weightG: number; quantity: number; lengthMm: number }): number | null {
  const v = kgPer12ft({ weightG: row.weightG, pieces: row.quantity, lengthMm: row.lengthMm });
  return v === null ? null : Math.round(v * 1000);
}
