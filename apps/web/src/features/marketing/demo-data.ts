/**
 * Sample packing-list rows, visibly marked "Demo data" and hidden from
 * screen readers. Bundle numbers use the plant's format; weights and totals
 * use the same formatters as the app. These are not results from a real plant.
 */
import { formatBundleNo, formatKg, formatKgTotal } from "@orrn/domain";

type DemoBundle = { serial: string; kg: number; pieces: number };

function bundle(seq: number, kg: number, pieces: number): DemoBundle {
  return { serial: formatBundleNo(2026, 10, seq), kg, pieces };
}

/** First row of the illustrative packing list. */
export const DEMO_BUNDLE = bundle(4086, 52.4, 21);

/** Rows of the illustrative packing list. */
export const DEMO_PACKING_LIST: DemoBundle[] = [
  DEMO_BUNDLE,
  bundle(4087, 51.85, 21),
  bundle(4088, 52.1, 21),
  bundle(4089, 49.95, 20),
];

export const demoKg = (b: DemoBundle) => formatKg(b.kg);
export const demoTotalKg = (rows: DemoBundle[]) => formatKgTotal(rows.reduce((sum, b) => sum + b.kg, 0));
