/**
 * Numeric fields and their canonical storage. One table, shared with the import portal's target catalogue.
 * Limits are canonical values. `hard` refuses, `plausible` flags. The numbers are first guesses from plant
 * scale (UNITS-A-REPORT.md lists them for the owner to correct); the structure is what slice a delivers.
 */
import type { Kind, UnitId } from "./registry";

export type QuantityField = {
  id: FieldId;
  kind: Kind;
  storage: UnitId;
  hard?: readonly [number, number];
  plausible?: readonly [number, number];
  whole?: boolean;
};

const T = 1_000_000; // grams in a tonne

const TABLE = {
  "bundle.weight": { kind: "mass", storage: "g", hard: [0, 50 * T], plausible: [1_000, 2 * T] },
  "bundle.length": { kind: "length", storage: "mm", hard: [0, 30_000], plausible: [300, 12_500] },
  /** Pressed length of a whole push on the press count: the server takes up to 100,000 m (100,000,000 mm), far past a bundle's 30 m. */
  "press.pressedLength": { kind: "length", storage: "mm", hard: [0, 100_000_000] },
  "bundle.pieces": { kind: "count", storage: "pcs", hard: [0, 1_000_000], plausible: [1, 5_000], whole: true },
  "order.cutLength": { kind: "length", storage: "mm", hard: [0, 30_000], plausible: [300, 12_500] },
  "order.weight": { kind: "mass", storage: "g", hard: [0, 5_000 * T], plausible: [1_000, 200 * T] },
  "order.pieces": { kind: "count", storage: "pcs", hard: [0, 10_000_000], plausible: [1, 100_000], whole: true },
  "order.rate": { kind: "money_per_mass", storage: "paise_kg", hard: [0, 10_000_000], plausible: [5_000, 200_000] },
  "order.amount": { kind: "money", storage: "paise", hard: [0, 100_000_000_000_00] },
  "purchase.weight": { kind: "mass", storage: "g", hard: [0, 5_000 * T], plausible: [1_000, 500 * T] },
  "purchase.rate": { kind: "money_per_mass", storage: "paise_kg", hard: [0, 10_000_000], plausible: [5_000, 200_000] },
  "die.band": { kind: "linear_mass", storage: "g_12ft", hard: [0, 100_000], plausible: [500, 30_000] },
  "die.width": { kind: "length", storage: "mm", hard: [0, 2_000], plausible: [5, 600] },
  "die.thickness": { kind: "length", storage: "mm", hard: [0, 2_000], plausible: [1, 200] },
  "die.wall": { kind: "length", storage: "tenth_mm", hard: [0, 5_000], plausible: [3, 400] },
  /** A die width, thickness or leg: it may carry a tenth of a mm, and a die is up to 2 m across (not the 500 mm of a wall). */
  "die.geometry": { kind: "length", storage: "tenth_mm", hard: [0, 20_000] },
  "press.input": { kind: "mass", storage: "g", hard: [0, 100 * T], plausible: [1_000, 20 * T] },
  "press.good": { kind: "mass", storage: "g", hard: [0, 100 * T], plausible: [0, 20 * T] },
  "press.pressure": { kind: "pressure", storage: "deci_bar", hard: [0, 10_000], plausible: [0, 4_000] },
  "press.ramSpeed": { kind: "speed", storage: "deci_mm_s", hard: [0, 10_000], plausible: [0, 1_500] },
  "ageing.temperature": { kind: "temperature", storage: "deci_c", hard: [-500, 15_000], plausible: [0, 3_000] },
  "foundry.fraction": { kind: "ratio", storage: "ppm", hard: [0, 1_000_000] },
  "customer.tolerance": { kind: "ratio", storage: "bp", hard: [0, 10_000], plausible: [0, 2_000] },
  "ageing.soak": { kind: "duration", storage: "min", hard: [0, 10_000], plausible: [10, 1_440] },
  "ageing.gas": { kind: "volume", storage: "l", hard: [0, 1_000_000_000] },
} as const satisfies Record<string, Omit<QuantityField, "id">>;

export type FieldId = keyof typeof TABLE;

export const FIELDS: Readonly<Record<FieldId, QuantityField>> = Object.freeze(
  Object.fromEntries(Object.entries(TABLE).map(([id, f]) => [id, { id, ...f }])),
) as Record<FieldId, QuantityField>;

export function resolveField(field: QuantityField | FieldId): QuantityField {
  if (typeof field !== "string") return field;
  const f = (FIELDS as Record<string, QuantityField | undefined>)[field];
  if (!f) throw new RangeError(`unknown field: ${field}`);
  return f;
}

export type StoreItemUnit = "kg" | "litre" | "metre" | "piece" | "set" | "box" | "bag";

/** A store item's quantity column (`qty_milli`) as a field, by the item's own unit. Reads the milli number unchanged. */
export function storeQuantityField(unit: StoreItemUnit): QuantityField {
  const cap = 100_000_000; // 100,000 units in milli-units (AGENTS.md store rules)
  switch (unit) {
    case "kg": return { id: "bundle.weight", kind: "mass", storage: "g", hard: [0, cap] };
    case "litre": return { id: "ageing.gas", kind: "volume", storage: "ml", hard: [0, cap] };
    case "metre": return { id: "bundle.length", kind: "length", storage: "mm", hard: [0, cap] };
    default: return { id: "bundle.pieces", kind: "count", storage: "milli_pcs", hard: [0, cap], whole: true };
  }
}
