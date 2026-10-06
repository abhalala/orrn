/**
 * Example numbers for the marketing pictures. Every picture that shows them
 * carries a visible "Demo data" label and is hidden from screen readers;
 * none of this is a claim about real plants. Bundle numbers use the plant's
 * own format (`26J4086`: year, month letter, monthly sequence) and every
 * derived figure goes through the same domain maths the app uses.
 */
import { formatBundleNo, formatKg, formatKgTotal, kgPer12ft, MM_PER_FOOT } from "@orrn/domain";

const CUT_LENGTH_MM = 12 * MM_PER_FOOT;

export type DemoBundle = { serial: string; kg: number; pieces: number };

function bundle(seq: number, kg: number, pieces: number): DemoBundle {
  return { serial: formatBundleNo(2026, 10, seq), kg, pieces };
}

/** The bundle being packed and scanned in the hero and the flow. */
export const DEMO_BUNDLE = bundle(4086, 52.4, 21);

/** Rows of the example packing list (one cut length, 12 ft). */
export const DEMO_PACKING_LIST: DemoBundle[] = [
  DEMO_BUNDLE,
  bundle(4087, 51.85, 21),
  bundle(4088, 52.1, 21),
  bundle(4089, 49.95, 20),
];

export const DEMO_STOCK = { inStock: 412, inStockKg: 18_940.5, held: 36, heldKg: 1_622 } as const;

export function demoKg12ft(b: DemoBundle): string {
  const value = kgPer12ft({ weightG: Math.round(b.kg * 1000), pieces: b.pieces, lengthMm: CUT_LENGTH_MM });
  return value === null ? "" : formatKg(value);
}

export const demoKg = (b: DemoBundle) => formatKg(b.kg);
export const demoTotalKg = (rows: DemoBundle[]) => formatKgTotal(rows.reduce((sum, b) => sum + b.kg, 0));
export { formatKgTotal };
