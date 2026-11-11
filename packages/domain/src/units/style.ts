/** Number style and the hand-built digit writer. No Intl, no float: Hermes, Workers and browsers print the same digits. */
import { pow10, roundHalfAway, type Ratio } from "./rational";

export type NumberStyle = {
  grouping: "indian" | "international" | "none";
  decimal: "." | ",";
  group: "," | "." | " " | " ";
};

export const DEFAULT_NUMBER_STYLE: NumberStyle = { grouping: "indian", decimal: ".", group: "," };

/** "1234567" to "12,34,567" (indian) or "1,234,567" (international). Digits only in, digits and marks out. */
export function groupDigits(digits: string, style: NumberStyle): string {
  if (style.grouping === "none" || digits.length <= 3) return digits;
  const tail = digits.slice(-3);
  let head = digits.slice(0, -3);
  const size = style.grouping === "indian" ? 2 : 3;
  const parts: string[] = [];
  while (head.length > size) {
    parts.unshift(head.slice(-size));
    head = head.slice(0, -size);
  }
  if (head) parts.unshift(head);
  parts.push(tail);
  return parts.join(style.group);
}

export type WriteOpts = {
  /** Drop trailing zeros of the fraction (and the mark if nothing is left). */
  trim?: boolean;
  /** With `trim`, keep at least this many decimals. */
  minDecimals?: number;
};

/**
 * Write `scaled / 10^decimals` as text. `scaled` is the amount already rounded to `decimals` places.
 * Never writes "-0".
 */
export function writeScaled(scaled: bigint, decimals: number, style: NumberStyle, opts: WriteOpts = {}): string {
  const d = Math.max(0, decimals);
  const neg = scaled < 0n;
  const abs = (neg ? -scaled : scaled).toString().padStart(d + 1, "0");
  const intPart = abs.slice(0, abs.length - d);
  let frac = d > 0 ? abs.slice(abs.length - d) : "";
  if (opts.trim) {
    const keep = Math.min(opts.minDecimals ?? 0, d);
    let end = frac.length;
    while (end > keep && frac[end - 1] === "0") end--;
    frac = frac.slice(0, end);
  }
  const sign = neg && (/[1-9]/.test(intPart) || /[1-9]/.test(frac)) ? "-" : "";
  return `${sign}${groupDigits(intPart, style)}${frac ? style.decimal + frac : ""}`;
}

/** Round an exact amount to `decimals` places (half away from zero) and write it. Negative decimals round to tens, hundreds. */
export function writeAmount(amount: Ratio, decimals: number, style: NumberStyle, opts: WriteOpts = {}): string {
  if (decimals >= 0) return writeScaled(roundHalfAway(amount.num * pow10(decimals), amount.den), decimals, style, opts);
  const q = roundHalfAway(amount.num, amount.den * pow10(-decimals)) * pow10(-decimals);
  return writeScaled(q, 0, style, opts);
}
