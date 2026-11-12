/** Text to exact amounts. Never throws for a person's text. Float-free: digits go straight to BigInt. */
import { addRatio, mulRatio, ratio, type Ratio } from "./rational";
import { findUnit, type UnitId } from "./registry";
import { DEFAULT_NUMBER_STYLE, type NumberStyle } from "./style";

export type ParseProblem =
  | "empty" | "invalid" | "grouping" | "decimals" | "whole" | "negative" | "tooBig" | "tooSmall" | "unit";

export type ParsedAmount = { ok: true; amount: Ratio; text: string } | { ok: false; problem: ParseProblem };

const MAX_DIGITS = 30;

/** Hindi and Gujarati digits read as Latin digits. Display never writes them (AGENTS.md). */
function foldDigits(s: string): string {
  return s.replace(/[\u0966-\u096f\u0ae6-\u0aef]/g, (c) => String(c.charCodeAt(0) - (c.charCodeAt(0) >= 0x0ae6 ? 0x0ae6 : 0x0966)));
}

function cleanText(text: string): string {
  return foldDigits(text.normalize("NFKC")).trim();
}

/** A sheet number as its shortest plain decimal text ("1.2e-7" gives "0.00000012"). Null for NaN and infinity. */
export function numberToDecimalText(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, int, frac = "", exp] = m;
  const digits = int! + frac;
  const point = int!.length + Number(exp);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

const SPACES = /[\s   ]/;

/** Whole groups laid out either the Indian way (12,34,567) or the western way (1,234,567). Both read unambiguously. */
function groupsValid(parts: string[]): boolean {
  if (parts.some((p) => !/^\d+$/.test(p))) return false;
  const [first, ...rest] = parts as [string, ...string[]];
  const west = first.length <= 3 && rest.every((p) => p.length === 3);
  const last = rest[rest.length - 1];
  const mid = rest.slice(0, -1);
  const india = first.length <= 2 && last !== undefined && last.length === 3 && mid.every((p) => p.length === 2);
  return west || india;
}

export function parseAmount(
  text: string,
  style: NumberStyle = DEFAULT_NUMBER_STYLE,
  opts: { negative?: boolean } = {},
): ParsedAmount {
  let t = cleanText(text);
  if (t === "") return { ok: false, problem: "empty" };
  let neg = false;
  if (t[0] === "-" || t[0] === "−") {
    neg = true;
    t = t.slice(1).trim();
  } else if (t[0] === "+") {
    t = t.slice(1).trim();
  }
  if (t === "" || /^[-+\u2212]/.test(t)) return { ok: false, problem: "invalid" };
  if (neg && !opts.negative) return { ok: false, problem: "negative" };

  const pieces = t.split(style.decimal);
  if (pieces.length > 2) return { ok: false, problem: "invalid" };
  const [intRaw, fracRaw = ""] = pieces as [string, string?];
  if (!/^\d*$/.test(fracRaw)) return { ok: false, problem: "invalid" };

  const groupChar = style.group === " " || style.group === " " ? null : style.group;
  let intDigits: string;
  const hasSpaceGroup = SPACES.test(intRaw);
  if (groupChar ? intRaw.includes(groupChar) : hasSpaceGroup) {
    if (style.grouping === "none") return { ok: false, problem: "grouping" };
    const parts = groupChar ? intRaw.split(groupChar) : intRaw.split(/[\s   ]+/);
    if (!groupsValid(parts)) return { ok: false, problem: "grouping" };
    intDigits = parts.join("");
  } else {
    if (!/^\d*$/.test(intRaw)) return { ok: false, problem: "invalid" };
    intDigits = intRaw;
  }
  if (intDigits === "" && fracRaw === "") return { ok: false, problem: "invalid" };
  const bareInt = intDigits.replace(/^0+(?=\d)/, "") || "0";
  if (bareInt.length > MAX_DIGITS || fracRaw.length > MAX_DIGITS) return { ok: false, problem: "tooBig" };
  const fracTrim = fracRaw.replace(/0+$/, "");
  const num = BigInt(bareInt + fracRaw);
  const amount = ratio(neg ? -num : num, 10n ** BigInt(fracRaw.length));
  const plain = `${neg && num !== 0n ? "-" : ""}${bareInt}${fracTrim ? "." + fracTrim : ""}`;
  return { ok: true, amount, text: plain };
}

export type ParsedLength =
  | {
      ok: true;
      amount: Ratio;
      /** The unit `amount` is in. A feet-and-inches text gives total inches. */
      unit: UnitId;
      /** True when the text named its own unit rather than using `plain`. */
      explicit: boolean;
      /** Set for feet-and-inches forms: the two parts as typed. */
      parts?: { feet?: Ratio; inches?: Ratio };
    }
  | { ok: false; problem: ParseProblem };

const INCH_MARK = /\s*(?:"|''|inches|inch|ins|in)\s*$/;
const FEET_MARK = /^(.*?)\s*(?:'|feet|foot|fts|ft)\s*(?:-\s*)?(.*)$/;

/** "6", "6.5", "1/4", "6 1/4" */
function parseMixed(raw: string, style: NumberStyle, neg: boolean): ParsedAmount {
  const s = raw.trim();
  const frac = /^(?:(.+?)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (frac) {
    const [, whole, n, d] = frac;
    if (BigInt(d!) === 0n) return { ok: false, problem: "invalid" };
    let amount = ratio(BigInt(n!), BigInt(d!));
    if (whole !== undefined) {
      const w = parseAmount(whole, style);
      if (!w.ok) return w;
      amount = addRatio(w.amount, amount);
    }
    return { ok: true, amount, text: "" };
  }
  return parseAmount(s, style, { negative: neg });
}

/**
 * Length text in any usual form: `12' 6"`, `12-6`, `12 ft 6 in`, `11 ft 6 1/4 in`, `6 in`, `3658 mm`, `3.658 m`, or a bare
 * number, which is read in `plain`. Feet-and-inches give total inches. Never throws.
 */
export function parseLengthText(
  text: string,
  plain: UnitId,
  opts: { style?: NumberStyle; negative?: boolean } = {},
): ParsedLength {
  const style = opts.style ?? DEFAULT_NUMBER_STYLE;
  let t = cleanText(text).toLowerCase().replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"').replace(/''/g, '"');
  if (t === "") return { ok: false, problem: "empty" };
  let neg = false;
  if (t[0] === "-" || t[0] === "−") {
    neg = true;
    t = t.slice(1).trim();
    if (!opts.negative) return { ok: false, problem: "negative" };
  }
  const sign = (r: Ratio): Ratio => (neg ? mulRatio(r, ratio(-1n)) : r);
  const num = (s: string): ParsedAmount => parseAmount(s, style);

  const withFeet = FEET_MARK.exec(t);
  if (withFeet && /\d$/.test((withFeet[1] ?? "").trim())) {
    const feet = num(withFeet[1]!.trim());
    if (!feet.ok) return feet;
    const rest0 = (withFeet[2] ?? "").trim();
    const restRaw = rest0.replace(INCH_MARK, "").trim();
    if (rest0 !== "" && restRaw === "") return { ok: false, problem: "invalid" };
    if (restRaw === "") return { ok: true, amount: sign(feet.amount), unit: "ft", explicit: true, parts: { feet: sign(feet.amount) } };
    const inches = parseMixed(restRaw, style, false);
    if (!inches.ok) return inches;
    const total = addRatio(mulRatio(feet.amount, ratio(12n)), inches.amount);
    return { ok: true, amount: sign(total), unit: "in", explicit: true, parts: { feet: sign(feet.amount), inches: inches.amount } };
  }
  const dash = /^(\d[\d,.]*)\s*-\s*(.+)$/.exec(t);
  if (dash) {
    const feet = num(dash[1]!);
    if (!feet.ok) return feet;
    const inches = parseMixed(dash[2]!.replace(INCH_MARK, "").trim(), style, false);
    if (!inches.ok) return inches;
    const total = addRatio(mulRatio(feet.amount, ratio(12n)), inches.amount);
    return { ok: true, amount: sign(total), unit: "in", explicit: true, parts: { feet: sign(feet.amount), inches: inches.amount } };
  }
  if (INCH_MARK.test(t) && /\d\s*(?:"|''|inches|inch|ins|in)\s*$/.test(t)) {
    const inches = parseMixed(t.replace(INCH_MARK, ""), style, false);
    if (!inches.ok) return inches;
    return { ok: true, amount: sign(inches.amount), unit: "in", explicit: true, parts: { inches: sign(inches.amount) } };
  }
  const suffixed = /^([\d.,\s  ]*\d[\d.,]*)\s*([a-z][a-z.]*)$/.exec(t);
  if (suffixed) {
    const unit = findUnit(suffixed[2]!, "length");
    if (!unit || unit === "ft_in") return { ok: false, problem: "unit" };
    const n = num(suffixed[1]!);
    if (!n.ok) return n;
    return { ok: true, amount: sign(n.amount), unit, explicit: true };
  }
  const bare = num(t);
  if (!bare.ok) return bare;
  return { ok: true, amount: sign(bare.amount), unit: plain, explicit: false };
}
