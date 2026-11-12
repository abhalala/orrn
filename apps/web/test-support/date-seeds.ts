/** Seeded instants and default formatters for the date parity tests (units layer, slice b part 3). */
import { formatterFor, screenPrefs, type Fmt } from "@orrn/domain";

export const IST_ZONE = "Asia/Kolkata";
export const NOW = Date.UTC(2026, 10, 10, 9, 0);

export function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Instants across 2024 to 2027, with the minutes around midnight IST, the turn of each year, every September 1 and 30 (the
 * month the old helpers spelled differently on some browsers) and the 29th of February.
 */
export function instants(seed: number, n: number): number[] {
  const r = mulberry(seed);
  const out = [
    Date.UTC(2025, 11, 31, 18, 29), Date.UTC(2025, 11, 31, 18, 30), Date.UTC(2026, 0, 1, 0, 0), Date.UTC(2026, 8, 5, 6, 0),
    Date.UTC(2024, 1, 29, 12, 0), Date.UTC(2026, 8, 1, 0, 0), Date.UTC(2026, 8, 30, 23, 59), Date.UTC(2026, 9, 24, 19, 0),
    Date.UTC(2026, 9, 24, 18, 29), Date.UTC(2026, 9, 24, 18, 30), Date.UTC(2026, 11, 31, 20, 0),
  ];
  while (out.length < n) out.push(Date.UTC(2024, 0, 1) + Math.floor(r() * 3 * 365 * 24 * 3600 * 1000));
  return out;
}

export const ymdOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const dflt = (locale: "en" | "hi" | "gu" = "en", timeZone = IST_ZONE): Fmt => formatterFor(screenPrefs({}), { locale, timeZone });

