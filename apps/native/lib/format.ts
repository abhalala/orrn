/**
 * Plain formatting for the phone's clock and the plant's serials. Pure (no
 * React Native imports) so bun tests run it. Month names come from i18n
 * (`native.monthsShort`), digits stay Latin in Hindi, as on the plant's paper.
 */

/** The 12 short month names from the comma-separated i18n string. */
export function monthNames(csv: string): string[] {
  return csv.split(",").map((m) => m.trim());
}

type DateLike = Date | number | string | null | undefined;

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "4 Oct" this year, "30 Dec 2025" otherwise, on the phone's local calendar; null for no date. */
export function formatDay(value: DateLike, months: readonly string[], now: Date = new Date()): string | null {
  const d = toDate(value);
  if (!d) return null;
  const base = `${d.getDate()} ${months[d.getMonth()] ?? ""}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** 24 hour "07:05" on the phone's clock; null for no time. */
export function formatTime(value: DateLike): string | null {
  const d = toDate(value);
  if (!d) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Natural order: digit runs compare as numbers, so "2207" < "14701" and "26J2" < "26J10". Case-insensitive. */
export function naturalCompare(a: string, b: string): number {
  const ax = a.toLowerCase().match(/\d+|\D+/g) ?? [];
  const bx = b.toLowerCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
    const x = ax[i]!;
    const y = bx[i]!;
    if (x === y) continue;
    const xn = /^\d/.test(x);
    const yn = /^\d/.test(y);
    if (xn && yn) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
      // Same value, different zero padding: shorter first.
      if (x.length !== y.length) return x.length - y.length;
      continue;
    }
    return x < y ? -1 : 1;
  }
  return ax.length - bx.length;
}

/** `Array.sort` comparator for plant serials (packing order, not text order). */
export const bySerial = naturalCompare;
