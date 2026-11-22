/**
 * XE-PRICE (lane PRICE, rows 1-9): the price master and the line rate.
 *
 * Indian extrusion is priced per kg as a base metal rate (NALCO list, LME-linked or typed by hand)
 * plus the plant's conversion, with an alloy surcharge, a finish price and add-ons. Money is integer
 * paise; rates are paise per kg (components per piece or per order). Every master row has an
 * effective-from date and is never edited: a change is a new row, and it applies only once it is
 * approved (approval kind `price_change`).
 *
 * Pure rules only. The server reads the rows, calls `resolveRate` / `computeLineRate`, and freezes
 * the `PriceBreakup` it returns on the order line (`sales_order_line.price_breakup`) at confirm time.
 * BILL reads `ratePaise` and, when present, this breakup.
 */

export const PRICE_RATE_KINDS = ["metal", "conversion", "alloy", "finish", "component", "customer", "line"] as const;
export type PriceRateKind = (typeof PRICE_RATE_KINDS)[number];

export const METAL_SOURCES = ["nalco", "lme", "manual"] as const;
export type MetalSource = (typeof METAL_SOURCES)[number];

/** A component add-on is charged per piece of the line or once per order. */
export const COMPONENT_BASES = ["piece", "order"] as const;
export type ComponentBasis = (typeof COMPONENT_BASES)[number];

/**
 * A customer's agreed terms: their own conversion per kg, a discount per kg off the computed rate,
 * or a fixed all-in rate per kg.
 */
export const CUSTOMER_TERM_MODES = ["conversion", "discount", "fixed"] as const;
export type CustomerTermMode = (typeof CUSTOMER_TERM_MODES)[number];

export const PRICE_RATE_STATUSES = ["pending", "active", "rejected"] as const;
export type PriceRateStatus = (typeof PRICE_RATE_STATUSES)[number];

/** Where a line's conversion came from, most specific first. */
export const CONVERSION_SOURCES = ["customer", "die", "series", "default"] as const;
export type ConversionSource = (typeof CONVERSION_SOURCES)[number];

/** Upper bound for any single rate (Rs 10 lakh per kg / per piece / per order) in paise. */
export const MAX_RATE_PAISE = 100_000_000;

/** LME inputs as the office types them: USD per tonne (cents), rupees per USD (paise), premium per kg (paise). */
export type LmeInputs = { usdPerTonneCents: number; inrPerUsdPaise: number; premiumPaisePerKg: number };

/** Round a non-negative fraction `a / b` half up (integers in, integer out). */
export function roundDiv(a: number, b: number): number {
  if (b <= 0) throw new RangeError("divisor must be positive");
  if (a < 0) return -roundDiv(-a, b);
  return Math.floor((2 * a + b) / (2 * b));
}

/**
 * LME-linked base rate in paise per kg: USD/t × Rs/USD ÷ 1000 kg/t, plus the premium.
 * `usdPerTonneCents × inrPerUsdPaise` is paise² per tonne × 100; ÷ 100 (cents) ÷ 1000 (kg) gives paise per kg.
 * 2,500.00 USD/t at Rs 83.50 = Rs 208.75/kg (20,875 paise) before the premium.
 */
export function lmePaisePerKg(inputs: LmeInputs): number {
  const { usdPerTonneCents, inrPerUsdPaise, premiumPaisePerKg } = inputs;
  for (const v of [usdPerTonneCents, inrPerUsdPaise, premiumPaisePerKg]) {
    if (!Number.isInteger(v) || v < 0) throw new RangeError("LME inputs are whole, non-negative numbers");
  }
  return roundDiv(usdPerTonneCents * inrPerUsdPaise, 100_000) + premiumPaisePerKg;
}

/** Master keys are compared lower case with spaces squeezed ("6061", "anodise", "Domal"). */
export function priceKey(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Conversion keys: the plant default, a section series (group), or one section (die). */
export const conversionKey = {
  default: () => "default",
  series: (series: string) => `series:${priceKey(series)}`,
  die: (dieId: string) => `die:${dieId}`,
};

/** Customer term keys: `<customerId>:<mode>`. */
export const customerTermKey = (customerId: string, mode: CustomerTermMode) => `${customerId}:${mode}`;

/** One master row as the server reads it (paise per kg, or per piece / per order for components). */
export type PriceRateRow = {
  id: string;
  kind: PriceRateKind;
  key: string;
  paise: number;
  /** Company calendar date `YYYY-MM-DD` the rate applies from. */
  effectiveFrom: string;
  status: PriceRateStatus;
  /** Created time in ms; breaks a tie between two rows from the same day (the later one wins). */
  createdAt: number;
  detail?: Record<string, unknown> | null;
};

/**
 * The rate that applies on `onDate`: the active row of (kind, key) with the latest effective-from
 * on or before that date (a later-created row wins a same-day tie). Pending and rejected rows never
 * apply, so until a change is approved the old rate stands.
 */
export function resolveRate(rows: readonly PriceRateRow[], kind: PriceRateKind, key: string, onDate: string): PriceRateRow | null {
  let best: PriceRateRow | null = null;
  for (const r of rows) {
    if (r.kind !== kind || r.key !== key || r.status !== "active" || r.effectiveFrom > onDate) continue;
    if (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && r.createdAt > best.createdAt)) best = r;
  }
  return best;
}

/** Every key of a kind that has a rate on `onDate` (components list, finish list). */
export function activeRatesOf(rows: readonly PriceRateRow[], kind: PriceRateKind, onDate: string): PriceRateRow[] {
  const keys = new Set(rows.filter((r) => r.kind === kind).map((r) => r.key));
  const out: PriceRateRow[] = [];
  for (const k of [...keys].sort()) {
    const r = resolveRate(rows, kind, k, onDate);
    if (r) out.push(r);
  }
  return out;
}

/** Plant pricing settings, stored under `company.settings.pricing`. */
export type PricingSettings = {
  /** The base metal list this plant quotes on. */
  metalSource: MetalSource;
  /** Estimated GST on a proforma, in basis points (1800 = 18 %). BILL owns the real GST. */
  estimatedGstBp: number;
  /** Days a new quotation stays valid. */
  quoteValidDays: number;
};

export const DEFAULT_PRICING_SETTINGS: PricingSettings = { metalSource: "nalco", estimatedGstBp: 1800, quoteValidDays: 15 };

export function readPricingSettings(raw: unknown): PricingSettings {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const src = s.metalSource;
  const bp = s.estimatedGstBp;
  const days = s.quoteValidDays;
  return {
    metalSource: typeof src === "string" && (METAL_SOURCES as readonly string[]).includes(src) ? (src as MetalSource) : DEFAULT_PRICING_SETTINGS.metalSource,
    estimatedGstBp: typeof bp === "number" && Number.isInteger(bp) && bp >= 0 && bp <= 10_000 ? bp : DEFAULT_PRICING_SETTINGS.estimatedGstBp,
    quoteValidDays: typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_PRICING_SETTINGS.quoteValidDays,
  };
}

/** One add-on on a line, priced from the component master. */
export type BreakupComponent = {
  key: string;
  label: string;
  basis: ComponentBasis;
  /** Rate per piece or per order, paise. */
  paise: number;
  /** Pieces (per piece) or 1 (per order). */
  qty: number;
  /** The part of the charge this line carries, paise (an order charge is spread over the lines by weight). */
  totalPaise: number;
  rateId: string | null;
};

/** A line override: a rate typed over the computed one, with who approved it when it was below. */
export type BreakupOverride = {
  ratePaise: number;
  reason: string;
  rateId: string;
  approvalId: string | null;
  approvedBy: string | null;
  requestedBy: string | null;
};

/**
 * The frozen price breakdown of one order (or quote) line. `finalPaisePerKg` is what
 * `sales_order_line.rate_paise` is set to. Shape version `v` lets later lanes read old snapshots.
 */
export type PriceBreakup = {
  v: 1;
  /** The company date the masters were read for. */
  rateDate: string;
  metal: { source: MetalSource; paisePerKg: number; rateDate: string; rateId: string; lme: LmeInputs | null };
  conversion: { paisePerKg: number; from: ConversionSource; rateId: string };
  alloy: { alloy: string | null; paisePerKg: number; rateId: string | null };
  finish: { finish: string | null; paisePerKg: number; rateId: string | null };
  components: BreakupComponent[];
  /** Σ components ÷ line kg, paise per kg (rounded once). */
  componentsPaisePerKg: number;
  discountPaisePerKg: number;
  /** A customer's fixed all-in rate per kg when one applies (it replaces the sum). */
  fixedPaisePerKg: number | null;
  /** The rate the master gives, before any override. */
  computedPaisePerKg: number;
  override: BreakupOverride | null;
  finalPaisePerKg: number;
};

export type ComputeLineInput = {
  rateDate: string;
  metal: { source: MetalSource; paisePerKg: number; rateDate: string; rateId: string; lme?: LmeInputs | null } | null;
  conversion: { paisePerKg: number; from: ConversionSource; rateId: string } | null;
  alloy?: { alloy: string; paisePerKg: number; rateId: string } | { alloy: string | null; paisePerKg: 0; rateId: null } | null;
  finish?: { finish: string; paisePerKg: number; rateId: string } | { finish: string | null; paisePerKg: 0; rateId: null } | null;
  components?: BreakupComponent[];
  discountPaisePerKg?: number;
  fixedPaisePerKg?: number | null;
  /** Line weight in grams (the per-kg share of add-ons divides by it). */
  kgG: number;
  override?: BreakupOverride | null;
};

export type ComputeLineResult = { ok: true; breakup: PriceBreakup } | { ok: false; missing: ("metal" | "conversion" | "weight")[] };

/**
 * The line rate. metal + conversion + alloy surcharge + finish + add-ons per kg − discount, floored
 * at 0; a customer's fixed rate replaces the sum (add-ons are inside a fixed rate). An override, when
 * given, becomes the final rate and the computed one is kept beside it.
 */
export function computeLineRate(input: ComputeLineInput): ComputeLineResult {
  const missing: ("metal" | "conversion" | "weight")[] = [];
  if (!input.metal) missing.push("metal");
  if (!input.conversion) missing.push("conversion");
  if (!Number.isInteger(input.kgG) || input.kgG <= 0) missing.push("weight");
  if (missing.length > 0 || !input.metal || !input.conversion) return { ok: false, missing };

  const alloy = input.alloy ?? { alloy: null, paisePerKg: 0 as const, rateId: null };
  const finish = input.finish ?? { finish: null, paisePerKg: 0 as const, rateId: null };
  const components = input.components ?? [];
  const componentTotal = components.reduce((s, c) => s + c.totalPaise, 0);
  const componentsPaisePerKg = componentTotal > 0 ? roundDiv(componentTotal * 1000, input.kgG) : 0;
  const discount = Math.max(0, input.discountPaisePerKg ?? 0);
  const fixed = input.fixedPaisePerKg ?? null;

  const sum = input.metal.paisePerKg + input.conversion.paisePerKg + alloy.paisePerKg + finish.paisePerKg + componentsPaisePerKg;
  const computed = fixed != null ? fixed : Math.max(0, sum - discount);
  const override = input.override ?? null;

  return {
    ok: true,
    breakup: {
      v: 1,
      rateDate: input.rateDate,
      metal: { source: input.metal.source, paisePerKg: input.metal.paisePerKg, rateDate: input.metal.rateDate, rateId: input.metal.rateId, lme: input.metal.lme ?? null },
      conversion: { ...input.conversion },
      alloy: { alloy: alloy.alloy, paisePerKg: alloy.paisePerKg, rateId: alloy.rateId },
      finish: { finish: finish.finish, paisePerKg: finish.paisePerKg, rateId: finish.rateId },
      components,
      componentsPaisePerKg,
      discountPaisePerKg: fixed != null ? 0 : discount,
      fixedPaisePerKg: fixed,
      computedPaisePerKg: computed,
      override,
      finalPaisePerKg: override ? override.ratePaise : computed,
    },
  };
}

/** A line override below the computed rate needs a second person (`price_change`); at or above it does not. */
export function overrideNeedsApproval(computedPaisePerKg: number, requestedPaisePerKg: number): boolean {
  return requestedPaisePerKg < computedPaisePerKg;
}

/**
 * Spread a whole-order charge over the lines by weight, in paise, so the parts add up exactly
 * (largest remainder; ties go to the earlier line). Lines with no weight carry nothing.
 */
export function spreadByWeight(totalPaise: number, weightsG: readonly number[]): number[] {
  const total = weightsG.reduce((s, w) => s + Math.max(0, w), 0);
  if (totalPaise <= 0 || total <= 0) return weightsG.map(() => 0);
  const raw = weightsG.map((w) => (Math.max(0, w) * totalPaise) / total);
  const base = raw.map(Math.floor);
  let left = totalPaise - base.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (weightsG[i]! <= 0) continue;
    base[i]! += 1;
    left -= 1;
  }
  return base;
}

/** Line amount in paise: kg × rate, rounded once (`round(g × paisePerKg / 1000)`). */
export function lineAmountPaise(kgG: number, paisePerKg: number): number {
  return roundDiv(kgG * paisePerKg, 1000);
}

/** Estimated GST on an amount at `bp` basis points (proforma only; BILL owns the tax invoice). */
export function estimateGstPaise(amountPaise: number, bp: number): number {
  return roundDiv(amountPaise * bp, 10_000);
}

/** Proforma totals: Σ line amounts, estimated GST, and the total with it. */
export function proformaTotals(lines: readonly { kgG: number; paisePerKg: number }[], gstBp: number, extraPaise = 0) {
  const subtotalPaise = lines.reduce((s, l) => s + lineAmountPaise(l.kgG, l.paisePerKg), 0) + extraPaise;
  const gstPaise = estimateGstPaise(subtotalPaise, gstBp);
  return { subtotalPaise, gstBp, gstPaise, totalPaise: subtotalPaise + gstPaise };
}

/** Last day a quote is valid: the quote date plus `days` (calendar dates, `YYYY-MM-DD`). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

/** Enquiry states. `quoted` is set when a quote is linked; won / lost / dropped close it. */
export const ENQUIRY_STATUSES = ["open", "quoted", "won", "lost", "dropped"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export const OPEN_ENQUIRY_STATUSES: readonly EnquiryStatus[] = ["open", "quoted"];

/** An open enquiry whose follow-up date is before today is overdue. */
export function enquiryOverdue(e: { status: EnquiryStatus; followUpDate: string | null }, today: string): boolean {
  return OPEN_ENQUIRY_STATUSES.includes(e.status) && e.followUpDate != null && e.followUpDate < today;
}

/** Quote states: draft → sent → converted; draft / sent → cancelled. Expired is read from the date. */
export const QUOTE_STATUSES = ["draft", "sent", "converted", "cancelled"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export function quoteExpired(q: { status: QuoteStatus; validUntil: string }, today: string): boolean {
  return (q.status === "draft" || q.status === "sent") && q.validUntil < today;
}
