/**
 * XE-BILL row 13: tax invoice and credit note arithmetic. All money is integer paise, weights integer grams,
 * GST rates basis points (1800 = 18 %). The server computes every figure; clients only show them.
 *
 * Rounding (pinned with worked examples in gstInvoice.test.ts):
 * 1. Line taxable value = kg x rate, half up to the paisa: round(grams x paise-per-kg / 1000).
 *    A charge line (finish, components, packing) is a typed amount in paise.
 * 2. Each tax head (CGST, SGST, IGST) is rounded ONCE on the invoice total of its exact amounts,
 *    half up to the paisa, so the head never drifts from rate x taxable.
 * 3. Per-line tax is progressive: line i gets round(cumulative exact to i) - round(cumulative exact to i-1),
 *    so the line amounts add up to the head total exactly (no stray paisa on the e-invoice).
 * 4. CGST and SGST are each half the rate, computed separately (they are always equal).
 * 5. Round off: the grand total goes to the nearest rupee, half up; `roundOff` = rounded - exact, in -49..+50 paise.
 */
import { taxHeadsFor, type SupplyType } from "./gst";

/** Half-up integer division for non-negative numerator and positive denominator. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError("divRoundHalfUp needs safe integers and a positive denominator");
  }
  if (numerator < 0) return -divRoundHalfUp(-numerator, denominator);
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Taxable value of a weight line: grams x paise per kg, half up to the paisa. */
export function lineTaxablePaise(weightG: number, ratePaisePerKg: number): number {
  if (!Number.isSafeInteger(weightG) || weightG < 0) throw new RangeError("weightG must be a non-negative integer");
  if (!Number.isSafeInteger(ratePaisePerKg) || ratePaisePerKg < 0) throw new RangeError("rate must be a non-negative integer");
  return divRoundHalfUp(weightG * ratePaisePerKg, 1000);
}

export type InvoiceLineInput = {
  key: string;
  description: string;
  hsn: string;
  uqc: string;
  /** GST rate, basis points. */
  gstRateBp: number;
} & ({ kind: "weight"; weightG: number; ratePaise: number } | { kind: "charge"; amountPaise: number });

export type InvoiceLine = {
  key: string;
  description: string;
  hsn: string;
  uqc: string;
  gstRateBp: number;
  kind: "weight" | "charge";
  weightG: number | null;
  ratePaise: number | null;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};

export type InvoiceTotals = {
  lines: InvoiceLine[];
  weightG: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  /** Exact grand total before round off. */
  exactPaise: number;
  roundOffPaise: number;
  /** Grand total, a whole number of rupees. */
  totalPaise: number;
  /** Per HSN and rate, for the HSN summary printed under the lines. */
  hsnSummary: { hsn: string; gstRateBp: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }[];
};

/** Progressive split: line i gets round(cum_i / d) - round(cum_{i-1} / d). Sums to round(total / d). */
function progressive(numerators: number[], denominator: number): number[] {
  let cum = 0;
  let prev = 0;
  return numerators.map((n) => {
    cum += n;
    const r = divRoundHalfUp(cum, denominator);
    const out = r - prev;
    prev = r;
    return out;
  });
}

export function computeInvoice(inputs: readonly InvoiceLineInput[], supply: SupplyType): InvoiceTotals {
  if (inputs.length === 0) throw new RangeError("An invoice needs at least one line");
  const heads = taxHeadsFor(supply);
  const base = inputs.map((l) => {
    if (!Number.isInteger(l.gstRateBp) || l.gstRateBp < 0 || l.gstRateBp > 10_000) throw new RangeError("GST rate out of range");
    const taxable = l.kind === "weight" ? lineTaxablePaise(l.weightG, l.ratePaise) : l.amountPaise;
    if (!Number.isSafeInteger(taxable) || taxable < 0) throw new RangeError("A charge must be a non-negative whole number of paise");
    return { l, taxable };
  });
  // Exact tax x 20000 for a half rate (CGST, SGST) and x 10000 for IGST: integers, no floating point.
  const halfNumerators = base.map(({ l, taxable }) => taxable * l.gstRateBp);
  const zero = base.map(() => 0);
  const cgst = heads === "cgst_sgst" ? progressive(halfNumerators, 20_000) : zero;
  const sgst = heads === "cgst_sgst" ? progressive(halfNumerators, 20_000) : zero;
  const igst = heads === "igst" ? progressive(halfNumerators, 10_000) : zero;

  const lines: InvoiceLine[] = base.map(({ l, taxable }, i) => ({
    key: l.key,
    description: l.description,
    hsn: l.hsn,
    uqc: l.uqc,
    gstRateBp: l.gstRateBp,
    kind: l.kind,
    weightG: l.kind === "weight" ? l.weightG : null,
    ratePaise: l.kind === "weight" ? l.ratePaise : null,
    taxablePaise: taxable,
    cgstPaise: cgst[i]!,
    sgstPaise: sgst[i]!,
    igstPaise: igst[i]!,
    totalPaise: taxable + cgst[i]! + sgst[i]! + igst[i]!,
  }));
  const sum = (f: (x: InvoiceLine) => number) => lines.reduce((n, x) => n + f(x), 0);
  const taxablePaise = sum((x) => x.taxablePaise);
  const cgstPaise = sum((x) => x.cgstPaise);
  const sgstPaise = sum((x) => x.sgstPaise);
  const igstPaise = sum((x) => x.igstPaise);
  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  const exactPaise = taxablePaise + taxPaise;
  const totalPaise = divRoundHalfUp(exactPaise, 100) * 100;

  const summary = new Map<string, InvoiceTotals["hsnSummary"][number]>();
  for (const x of lines) {
    const k = `${x.hsn}|${x.gstRateBp}`;
    const row = summary.get(k) ?? { hsn: x.hsn, gstRateBp: x.gstRateBp, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    row.taxablePaise += x.taxablePaise;
    row.cgstPaise += x.cgstPaise;
    row.sgstPaise += x.sgstPaise;
    row.igstPaise += x.igstPaise;
    summary.set(k, row);
  }
  return {
    lines,
    weightG: lines.reduce((n, x) => n + (x.weightG ?? 0), 0),
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise,
    exactPaise,
    roundOffPaise: totalPaise - exactPaise,
    totalPaise,
    hsnSummary: [...summary.values()],
  };
}

// ---------------------------------------------------------------------------
// Money text
// ---------------------------------------------------------------------------

/** "1,23,456.78" (Indian grouping, always two decimals). */
export function rupeesText(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = String(abs % 100).padStart(2, "0");
  const s = String(rupees);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${rest ? `${rest},` : ""}${last3}.${p}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below100(n: number): string {
  if (n < 20) return ONES[n]!;
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
}

/** Whole number in Indian words: crore, lakh, thousand, hundred. 0 = "Zero". */
export function indianNumberWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("indianNumberWords needs a non-negative integer");
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indianNumberWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

/** "Rupees Three Lakh Fifty Seven Thousand Six Hundred Forty Two and Five Paise Only" (English, the printed invoice). */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new RangeError("amountInWords needs non-negative paise");
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  return `Rupees ${indianNumberWords(rupees)}${p ? ` and ${below100(p)} Paise` : ""} Only`;
}

/** Quantity text for the invoice: kg to the gram, Indian grouping ("1,234.567"). */
export function kgQtyText(weightG: number): string {
  const kg = Math.floor(weightG / 1000);
  const g = String(weightG % 1000).padStart(3, "0");
  return `${rupeesText(kg * 100).slice(0, -3)}.${g}`;
}
