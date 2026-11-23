import { lengthFromInput, parseDecimal } from "@orrn/domain";

/** The three boxes of the pack cut length. The packer types in ONE; the other two show the same length. */
export type LengthBox = "ft" | "in" | "mm";
export type LengthTyped = { typed: LengthBox; text: string };

export const EMPTY_LENGTH: LengthTyped = { typed: "mm", text: "" };

/** Stored mm as the typed mm box (a draft or an order line gives mm). */
export function lengthTypedFromMm(mm: number): LengthTyped {
  return mm > 0 ? { typed: "mm", text: String(Math.round(mm)) } : EMPTY_LENGTH;
}

/** Whole mm of what was typed (1 ft = 12 in = 304.8 mm, exact); null when empty or not a length. */
export function lengthMmOf(v: LengthTyped): number | null {
  if (v.text.trim() === "") return null;
  if (v.typed === "mm") return lengthFromInput({ unit: "mm", mm: v.text });
  return lengthFromInput({ unit: "inch", ...(v.typed === "ft" ? { feet: v.text } : { inches: v.text }) });
}

/** At most 3 decimals, zeros dropped. */
function trim3(n: number): string {
  return String(Number(n.toFixed(3)));
}

/** The text each box shows: the typed one as typed, the other two worked out (3 decimals for ft and in, whole mm). */
export function lengthBoxTexts(v: LengthTyped): Record<LengthBox, string> {
  const own = { ft: "", in: "", mm: "", [v.typed]: v.text } as Record<LengthBox, string>;
  const n = parseDecimal(v.text);
  if (n === null || v.text.trim() === "") return own;
  const mm = lengthMmOf(v);
  if (v.typed === "mm") {
    if (mm === null) return own;
    return { ...own, ft: trim3(n / 304.8), in: trim3(n / 25.4) };
  }
  if (v.typed === "ft") return { ...own, in: trim3(n * 12), mm: mm === null ? "" : String(mm) };
  return { ...own, ft: trim3(n / 12), mm: mm === null ? "" : String(mm) };
}

export function lengthTyped(v: LengthTyped): boolean {
  return v.text.trim() !== "";
}
