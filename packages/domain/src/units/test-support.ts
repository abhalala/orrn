/** Test helpers for the units layer: a seeded generator and an independent reference built from the definitions. */
import type { UnitId } from "./registry";

/** mulberry32: small, seeded, the same numbers on every machine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

/**
 * Factors written as decimal text, straight from the definitions (1 in = 25.4 mm, 1 lb = 0.45359237 kg,
 * 12 ft = 3.6576 m, 1 kgf = 9.80665 N). Not read from the registry, so the registry is checked against them.
 */
export const DEFINITION_FACTOR: Partial<Record<UnitId, string>> = {
  g: "1", kg: "1000", quintal: "100000", t: "1000000", lb: "453.59237",
  um: "0.001", tenth_mm: "0.1", mm: "1", cm: "10", m: "1000", in: "25.4", tenth_in: "2.54", ft: "304.8",
  g_12ft: "1", kg_12ft: "1000", kg_m: "3657.6", g_m: "3.6576", kg_ft: "12000", lb_ft: "5443.10844",
  paise: "1", inr: "100", paise_kg: "1", inr_kg: "100", inr_quintal: "1", inr_t: "0.1",
  ppm: "1", bp: "100", pct: "10000",
  deci_bar: "1", bar: "10", mpa: "100", kgf_cm2: "9.80665",
  deci_mm_s: "1", mm_s: "10", ft_min: "50.8",
  ml: "1", l: "1000", m3: "1000000", ms: "1", s: "1000", min: "60000", h: "3600000",
  pcs: "1", milli_pcs: "0.001",
};

export type Frac = { n: bigint; d: bigint };

export function decimalToFrac(text: string): Frac {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`bad decimal ${text}`);
  const frac = m[3] ?? "";
  return { n: BigInt(`${m[1]}${m[2]}${frac}`), d: 10n ** BigInt(frac.length) };
}

/** Reference conversion: typed decimal text in `unit` to the storage integer, half up, plain bigint maths. */
export function refStore(text: string, unit: UnitId, storage: UnitId): { value: bigint; exact: boolean } {
  const a = decimalToFrac(text);
  const fu = decimalToFrac(DEFINITION_FACTOR[unit]!);
  const fs = decimalToFrac(DEFINITION_FACTOR[storage]!);
  const n = a.n * fu.n * fs.d;
  const d = a.d * fu.d * fs.n;
  const abs = n < 0n ? -n : n;
  const q = (2n * abs + d) / (2n * d);
  return { value: n < 0n ? -q : q, exact: abs % d === 0n };
}

/** A random decimal with `decimals` places and up to `intDigits` whole digits, as text. */
export function randDecimal(r: () => number, intDigits: number, decimals: number): string {
  const whole = String(randInt(r, 0, 10 ** Math.min(intDigits, 9) - 1));
  if (decimals <= 0) return decimals === 0 ? whole : String(Number(whole) * 10 ** -decimals);
  let frac = "";
  for (let i = 0; i < decimals; i++) frac += String(randInt(r, 0, 9));
  return `${whole}.${frac}`;
}
