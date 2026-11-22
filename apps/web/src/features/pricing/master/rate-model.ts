/**
 * The price master page, as plain functions (no React): grouping what `pricing.rates.current` returns by
 * kind, naming each row, the London metal price preview (the same formula the server stores), and turning
 * the change form into a `pricing.rates.propose` input. Money is integer paise; people type rupees.
 */
import {
  lmePaisePerKg,
  MAX_RATE_PAISE,
  withoutGrouping,
  type LmeInputs,
  type MetalSource,
} from "@orrn/domain";

export const MASTER_KINDS = ["metal", "conversion", "alloy", "finish", "component", "customer"] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];

export function isMasterKind(v: unknown): v is MasterKind {
  return typeof v === "string" && (MASTER_KINDS as readonly string[]).includes(v);
}

/** One rate row as `pricing.rates.current` gives it (only what this page reads). */
export type RateRow = {
  id: string;
  paise: number;
  effectiveFrom: string;
  status: string;
  detail?: unknown;
  reason?: string | null;
};

export type RateItem = {
  kind: string;
  key: string;
  name: string | null;
  current: RateRow | null;
  pending: readonly RateRow[];
  upcoming: readonly RateRow[];
};

const METAL_ORDER: readonly string[] = ["nalco", "lme", "manual"];

/** What a row is called; the screen turns each shape into words in the person's language. */
export type RateTitle =
  | { type: "metal"; source: MetalSource }
  | { type: "conversionDefault" }
  | { type: "conversionSeries"; series: string }
  | { type: "conversionDie"; code: string }
  | { type: "plain"; text: string }
  | { type: "customer"; name: string; mode: "conversion" | "discount" | "fixed" };

const detailOf = (row: { detail?: unknown } | null | undefined): Record<string, unknown> =>
  row?.detail && typeof row.detail === "object" ? (row.detail as Record<string, unknown>) : {};

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The row's most recent detail: the current rate's, else a pending one's, else an upcoming one's. */
function anyDetail(item: RateItem): Record<string, unknown> {
  return detailOf(item.current ?? item.pending[0] ?? item.upcoming[0] ?? null);
}

export function rateTitle(item: RateItem): RateTitle {
  const key = item.key;
  if (item.kind === "metal") return { type: "metal", source: (METAL_ORDER.includes(key) ? key : "manual") as MetalSource };
  if (item.kind === "conversion") {
    if (key.startsWith("series:")) return { type: "conversionSeries", series: text(anyDetail(item).series) || key.slice(7) };
    if (key.startsWith("die:")) return { type: "conversionDie", code: item.name ?? key.slice(4) };
    return { type: "conversionDefault" };
  }
  if (item.kind === "component") return { type: "plain", text: text(anyDetail(item).label) || key };
  if (item.kind === "customer") {
    const mode = key.split(":")[1];
    return { type: "customer", name: item.name ?? key.split(":")[0]!, mode: mode === "discount" || mode === "fixed" ? mode : "conversion" };
  }
  // Alloy and finish: the words the office typed, else the lower-case key.
  return { type: "plain", text: text(anyDetail(item).alloy) || text(anyDetail(item).finish) || key };
}

/** A sort word so the list is stable: default conversion first, series before one section, then by name. */
function sortKey(item: RateItem): string {
  const title = rateTitle(item);
  switch (title.type) {
    case "metal":
      return String(METAL_ORDER.indexOf(title.source));
    case "conversionDefault":
      return "0";
    case "conversionSeries":
      return `1 ${title.series.toLowerCase()}`;
    case "conversionDie":
      return `2 ${title.code.toLowerCase()}`;
    case "plain":
      return title.text.toLowerCase();
    case "customer":
      return `${title.name.toLowerCase()} ${title.mode}`;
  }
}

export type RateGroups = Record<MasterKind, RateItem[]>;

/** Every kind gets a list (empty when nothing is set); `line` rows never come here. */
export function groupByKind(items: readonly RateItem[]): RateGroups {
  const out: RateGroups = { metal: [], conversion: [], alloy: [], finish: [], component: [], customer: [] };
  for (const item of items) if (isMasterKind(item.kind)) out[item.kind].push(item);
  for (const kind of MASTER_KINDS) out[kind].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  return out;
}

/** The unit a rate is quoted in: per kg, or per piece / per order for an add-on. */
export type RateUnit = "kg" | "piece" | "order";
export function rateUnit(item: RateItem): RateUnit {
  if (item.kind !== "component") return "kg";
  return anyDetail(item).basis === "order" ? "order" : "piece";
}

/** An add-on's own rule: charged on every order, or only when picked on a quote line. */
export function componentAlways(item: RateItem): boolean {
  return item.kind === "component" && anyDetail(item).always === true;
}

/** A pending row exists for this rate: no second change can be sent until it is decided. */
export const hasPending = (item: RateItem): boolean => item.pending.length > 0;

/** The part of the master the server needs before it prices a line, and which of them is missing now. */
export function missingParts(items: readonly RateItem[], metalSource: string): ("metal" | "conversion")[] {
  const out: ("metal" | "conversion")[] = [];
  if (!items.some((i) => i.kind === "metal" && i.key === metalSource && i.current)) out.push("metal");
  if (!items.some((i) => i.kind === "conversion" && i.key === "default" && i.current)) out.push("conversion");
  return out;
}

/* ------------------------------ typed numbers ------------------------------ */

/**
 * Typed rupees (or dollars) as whole hundredths, exact: "83.505" is 8351, half up. Grouping commas are
 * accepted as everywhere else. Null for anything that is not a plain non-negative number.
 */
export function hundredths(raw: string): number | null {
  const cleaned = withoutGrouping(raw);
  if (cleaned === null || !/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const [whole = "", frac = ""] = cleaned.split(".");
  const base = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  const n = base + (frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0);
  return Number.isSafeInteger(n) ? n : null;
}

/** Basis points typed as a percent ("18", "12.5"): whole basis points, 0 to 10 000. */
export function percentToBp(raw: string): number | null {
  const n = hundredths(raw);
  return n !== null && n <= 10_000 ? n : null;
}

/** "1800" bp -> "18"; "1250" bp -> "12.5". */
export function bpToPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const rest = bp % 100;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

/** Whole days from typed text, 1 to 365; null when it is not. */
export function daysOf(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 365 ? n : null;
}

/* ------------------------------ London metal ------------------------------- */

export type LmeForm = { usd: string; inr: string; premium: string };

/**
 * The rate per kg the three typed numbers give, with the same formula the server stores (`lmePaisePerKg`).
 * Null while a number is missing or out of range. A blank premium is 0.
 */
export function lmePreview(form: LmeForm): { inputs: LmeInputs; paisePerKg: number } | null {
  const usdPerTonneCents = hundredths(form.usd);
  const inrPerUsdPaise = hundredths(form.inr);
  const premiumPaisePerKg = form.premium.trim() === "" ? 0 : hundredths(form.premium);
  if (usdPerTonneCents === null || inrPerUsdPaise === null || premiumPaisePerKg === null) return null;
  if (usdPerTonneCents < 1 || usdPerTonneCents > 10_000_000) return null;
  if (inrPerUsdPaise < 1 || inrPerUsdPaise > 100_000) return null;
  if (premiumPaisePerKg > MAX_RATE_PAISE) return null;
  const inputs: LmeInputs = { usdPerTonneCents, inrPerUsdPaise, premiumPaisePerKg };
  const paisePerKg = lmePaisePerKg(inputs);
  return paisePerKg > MAX_RATE_PAISE ? null : { inputs, paisePerKg };
}

/** The three boxes filled from a stored London metal row's detail (empty strings when it holds none). */
export function lmeFormFrom(detail: unknown): LmeForm {
  const d = detailOf({ detail });
  const fixed = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? hundredthsToDecimal(v) : "");
  return { usd: fixed(d.usdPerTonneCents), inr: fixed(d.inrPerUsdPaise), premium: fixed(d.premiumPaisePerKg) };
}

/** 20875 -> "208.75". */
export function hundredthsToDecimal(hundredthsValue: number): string {
  const whole = Math.floor(hundredthsValue / 100);
  return `${whole}.${String(hundredthsValue % 100).padStart(2, "0")}`;
}

/* ------------------------------- the form ---------------------------------- */

export type RateForm = {
  kind: MasterKind;
  metalSource: MetalSource;
  rate: string;
  lme: LmeForm;
  scope: "default" | "series" | "die";
  series: string;
  sectionId: string | null;
  alloy: string;
  finish: string;
  label: string;
  basis: "piece" | "order";
  always: boolean;
  customerId: string | null;
  mode: "conversion" | "discount" | "fixed";
  effectiveFrom: string;
  reason: string;
};

export function emptyForm(kind: MasterKind, metalSource: MetalSource = "nalco"): RateForm {
  return {
    kind,
    metalSource,
    rate: "",
    lme: { usd: "", inr: "", premium: "" },
    scope: "default",
    series: "",
    sectionId: null,
    alloy: "",
    finish: "",
    label: "",
    basis: "piece",
    always: false,
    customerId: null,
    mode: "conversion",
    effectiveFrom: "",
    reason: "",
  };
}

/** The form for "Change rate" on a row: its key filled in, the rate box left for the new number. */
export function formFromItem(item: RateItem, metalSource: MetalSource): RateForm {
  const kind: MasterKind = isMasterKind(item.kind) ? item.kind : "metal";
  const form = emptyForm(kind, metalSource);
  const d = anyDetail(item);
  if (kind === "metal") {
    form.metalSource = (METAL_ORDER.includes(item.key) ? item.key : metalSource) as MetalSource;
    if (item.key === "lme") form.lme = lmeFormFrom(d);
  } else if (kind === "conversion") {
    if (item.key.startsWith("series:")) {
      form.scope = "series";
      form.series = text(d.series) || item.key.slice(7);
    } else if (item.key.startsWith("die:")) {
      form.scope = "die";
      form.sectionId = item.key.slice(4);
    }
  } else if (kind === "alloy") form.alloy = text(d.alloy) || item.key;
  else if (kind === "finish") form.finish = text(d.finish) || item.key;
  else if (kind === "component") {
    form.label = text(d.label) || item.key;
    form.basis = d.basis === "order" ? "order" : "piece";
    form.always = d.always === true;
  } else {
    const [customerId, mode] = item.key.split(":");
    form.customerId = customerId ?? null;
    form.mode = mode === "discount" || mode === "fixed" ? mode : "conversion";
  }
  return form;
}

export type FormErrorField = "rate" | "lme" | "series" | "die" | "alloy" | "finish" | "label" | "customer" | "reason" | "date";

/** The `change` of `pricing.rates.propose` (the server's input shape). */
export type RateChange =
  | { kind: "metal"; source: MetalSource; paisePerKg?: number; lme?: LmeInputs }
  | { kind: "conversion"; scope: "default" | "series" | "die"; series?: string; sectionId?: string; paisePerKg: number }
  | { kind: "alloy"; alloy: string; paisePerKg: number }
  | { kind: "finish"; finish: string; paisePerKg: number }
  | { kind: "component"; label: string; basis: "piece" | "order"; always: boolean; paise: number }
  | { kind: "customer"; customerId: string; mode: "conversion" | "discount" | "fixed"; paisePerKg: number };

export type ProposeInput = { change: RateChange; effectiveFrom?: string; reason: string };
export type BuildResult = { ok: true; input: ProposeInput } | { ok: false; errors: Partial<Record<FormErrorField, true>> };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Check the form and build the server input; every wrong box is named so the screen can mark it. */
export function buildPropose(form: RateForm): BuildResult {
  const errors: Partial<Record<FormErrorField, true>> = {};
  const rate = hundredths(form.rate);
  const rateOk = rate !== null && rate <= MAX_RATE_PAISE;
  const reason = form.reason.trim();
  if (reason.length < 3) errors.reason = true;
  if (form.effectiveFrom !== "" && !YMD.test(form.effectiveFrom)) errors.date = true;
  let change: RateChange | null = null;

  switch (form.kind) {
    case "metal": {
      if (form.metalSource === "lme") {
        const preview = lmePreview(form.lme);
        if (!preview) errors.lme = true;
        else change = { kind: "metal", source: "lme", lme: preview.inputs };
      } else if (!rateOk || rate === 0) errors.rate = true;
      else change = { kind: "metal", source: form.metalSource, paisePerKg: rate };
      break;
    }
    case "conversion": {
      if (!rateOk) errors.rate = true;
      if (form.scope === "series" && form.series.trim() === "") errors.series = true;
      if (form.scope === "die" && !form.sectionId) errors.die = true;
      if (rateOk && !errors.series && !errors.die) {
        change = {
          kind: "conversion",
          scope: form.scope,
          ...(form.scope === "series" ? { series: form.series.trim() } : {}),
          ...(form.scope === "die" ? { sectionId: form.sectionId! } : {}),
          paisePerKg: rate,
        };
      }
      break;
    }
    case "alloy":
      if (form.alloy.trim() === "" || form.alloy.trim().length > 16) errors.alloy = true;
      if (!rateOk) errors.rate = true;
      if (!errors.alloy && rateOk) change = { kind: "alloy", alloy: form.alloy.trim(), paisePerKg: rate };
      break;
    case "finish":
      if (form.finish.trim() === "" || form.finish.trim().length > 40) errors.finish = true;
      if (!rateOk) errors.rate = true;
      if (!errors.finish && rateOk) change = { kind: "finish", finish: form.finish.trim(), paisePerKg: rate };
      break;
    case "component":
      if (form.label.trim() === "" || form.label.trim().length > 60) errors.label = true;
      if (!rateOk) errors.rate = true;
      if (!errors.label && rateOk) change = { kind: "component", label: form.label.trim(), basis: form.basis, always: form.always, paise: rate };
      break;
    case "customer":
      if (!form.customerId) errors.customer = true;
      if (!rateOk) errors.rate = true;
      if (!errors.customer && rateOk) change = { kind: "customer", customerId: form.customerId!, mode: form.mode, paisePerKg: rate };
      break;
  }

  if (!change || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { change, ...(form.effectiveFrom !== "" ? { effectiveFrom: form.effectiveFrom } : {}), reason } };
}
