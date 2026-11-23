/**
 * Pure helpers for the asset and report screens (XE parity lane MAINT): form state to server payload,
 * warranty wording, plan interval words, the month range of the report and rupees typed as text.
 * Day strings are company days (`YYYY-MM-DD`); "today" comes in from the caller, in the plant's zone.
 */
import type { MessageKey } from "@orrn/i18n";

import { isAssetKind, isAssetStatus, isCriticality, isLinkKind, parseMilli, type AssetKind, type AssetStatus, type Criticality, type LinkKind } from "./model";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const MAX_MONTHS = 12;

export type AssetFormState = {
  code: string;
  name: string;
  kind: AssetKind;
  /** "" for no link, else `press:<id>`, `furnace:<id>`, `oven:<id>`. */
  link: string;
  make: string;
  serialNo: string;
  purchasedOn: string;
  warrantyUntil: string;
  location: string;
  criticality: Criticality;
  status: AssetStatus;
  note: string;
};

export function emptyAssetForm(): AssetFormState {
  return {
    code: "",
    name: "",
    kind: "press",
    link: "",
    make: "",
    serialNo: "",
    purchasedOn: "",
    warrantyUntil: "",
    location: "",
    criticality: "B",
    status: "running",
    note: "",
  };
}

export function linkValue(kind: string | null | undefined, id: string | null | undefined): string {
  return kind && id ? `${kind}:${id}` : "";
}

type AssetLike = {
  code: string;
  name: string;
  kind: string;
  linkKind: string | null;
  linkId: string | null;
  make: string | null;
  serialNo: string | null;
  purchasedOn: string | null;
  warrantyUntil: string | null;
  location: string | null;
  criticality: string;
  status: string;
  note: string | null;
};

export function formFromAsset(a: AssetLike): AssetFormState {
  return {
    code: a.code,
    name: a.name,
    kind: isAssetKind(a.kind) ? a.kind : "other",
    link: linkValue(a.linkKind, a.linkId),
    make: a.make ?? "",
    serialNo: a.serialNo ?? "",
    purchasedOn: a.purchasedOn ?? "",
    warrantyUntil: a.warrantyUntil ?? "",
    location: a.location ?? "",
    criticality: isCriticality(a.criticality) ? a.criticality : "B",
    status: isAssetStatus(a.status) ? a.status : "running",
    note: a.note ?? "",
  };
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());
const dayOrNull = (s: string): string | null => (DAY.test(s.trim()) ? s.trim() : null);

export function splitLink(link: string): {
  linkKind: LinkKind | null;
  linkId: string | null;
} {
  const at = link.indexOf(":");
  if (at < 0) return { linkKind: null, linkId: null };
  const kind = link.slice(0, at);
  const id = link.slice(at + 1);
  return isLinkKind(kind) && id ? { linkKind: kind, linkId: id } : { linkKind: null, linkId: null };
}

/** The master kind an asset kind can link to; other kinds link to nothing. */
export function linkKindFor(kind: AssetKind): LinkKind | null {
  return kind === "press" || kind === "furnace" || kind === "oven" ? kind : null;
}

/** True when a `kind:id` link is empty or fits the asset kind. */
export function linkFitsKind(kind: AssetKind, link: string): boolean {
  if (link === "") return true;
  const { linkKind } = splitLink(link);
  return linkKind !== null && linkKind === linkKindFor(kind);
}

export function assetFormValid(f: AssetFormState): boolean {
  return f.code.trim() !== "" && f.name.trim() !== "";
}

/** The body of `maint.assets.create` (and `update`, with `id` and `serverSeq` added): empty text becomes null. */
export function assetPayload(f: AssetFormState) {
  return {
    code: f.code.trim(),
    name: f.name.trim(),
    kind: f.kind,
    ...splitLink(f.link),
    make: orNull(f.make),
    serialNo: orNull(f.serialNo),
    purchasedOn: dayOrNull(f.purchasedOn),
    warrantyUntil: dayOrNull(f.warrantyUntil),
    location: orNull(f.location),
    criticality: f.criticality,
    status: f.status,
    note: orNull(f.note),
  };
}

export type WarrantyState = { state: "under" | "ended"; day: string } | null;

/** Warranty by comparing two company days: valid through its last day. */
export function warrantyState(warrantyUntil: string | null | undefined, today: string): WarrantyState {
  if (!warrantyUntil || !DAY.test(warrantyUntil)) return null;
  return {
    state: warrantyUntil >= today ? "under" : "ended",
    day: warrantyUntil,
  };
}

export type Words = { key: MessageKey; vars?: Record<string, string | number> };

/** The interval of a plan in words: days, run hours, or both. */
export function planIntervalWords(days: number | null, hours: number | null): Words | null {
  if (days != null && hours != null) return { key: "maint.assets.plans.everyBoth", vars: { days, hours } };
  if (days != null) return { key: "maint.assets.plans.everyDays", vars: { n: days } };
  if (hours != null) return { key: "maint.assets.plans.everyHours", vars: { n: hours } };
  return null;
}

export type PlanFormState = {
  title: string;
  steps: string;
  days: string;
  hours: string;
  active: boolean;
  startOn: string;
};

export function emptyPlanForm(): PlanFormState {
  return {
    title: "",
    steps: "",
    days: "",
    hours: "",
    active: true,
    startOn: "",
  };
}

export function formFromPlan(p: { title: string; steps: string | null; intervalDays: number | null; intervalHours: number | null; active: boolean }): PlanFormState {
  return {
    title: p.title,
    steps: p.steps ?? "",
    days: p.intervalDays == null ? "" : String(p.intervalDays),
    hours: p.intervalHours == null ? "" : String(p.intervalHours),
    active: p.active,
    startOn: "",
  };
}

/** Whole number text, or null when empty or not a positive whole number. */
export function wholeOrNull(text: string): number | null {
  const t = text.trim();
  return /^\d{1,7}$/.test(t) && Number(t) > 0 ? Number(t) : null;
}

export type PlanProblem = "title" | "interval" | null;

export function planProblem(f: PlanFormState, linked: boolean): PlanProblem {
  if (f.title.trim() === "") return "title";
  const days = wholeOrNull(f.days);
  const hours = linked ? wholeOrNull(f.hours) : null;
  if (f.days.trim() !== "" && days == null) return "interval";
  if (linked && f.hours.trim() !== "" && hours == null) return "interval";
  return days == null && hours == null ? "interval" : null;
}

/** Plan body for create or update. Run hours are dropped when the asset has no link (the server refuses them). */
export function planPayload(f: PlanFormState, linked: boolean) {
  return {
    title: f.title.trim(),
    steps: orNull(f.steps),
    intervalDays: wholeOrNull(f.days),
    intervalHours: linked ? wholeOrNull(f.hours) : null,
  };
}

export type KindFormState = {
  name: string;
  unit: string;
  low: string;
  high: string;
  active: boolean;
};

export function emptyKindForm(): KindFormState {
  return { name: "", unit: "", low: "", high: "", active: true };
}

export function formFromKind(
  k: {
    name: string;
    unit: string;
    minMilli: number | null;
    maxMilli: number | null;
    active: boolean;
  },
  milliText: (m: number | null) => string,
): KindFormState {
  return {
    name: k.name,
    unit: k.unit,
    low: milliText(k.minMilli),
    high: milliText(k.maxMilli),
    active: k.active,
  };
}

export type KindProblem = "name" | "limit" | null;

/** A limit box is empty (no limit) or a number with at most 3 decimals. */
export function limitMilli(text: string): number | null | "bad" {
  if (text.trim() === "") return null;
  const v = parseMilli(text);
  return v == null ? "bad" : v;
}

/** The API bound of a limit, in thousandths of the plant's unit. */
export const LIMIT_MILLI_MAX = 1_000_000_000;

const limitBad = (text: string): boolean => {
  const v = limitMilli(text);
  return v === "bad" || (v !== null && Math.abs(v) > LIMIT_MILLI_MAX);
};

export function kindProblem(f: KindFormState): KindProblem {
  if (f.name.trim() === "" || f.unit.trim() === "") return "name";
  return limitBad(f.low) || limitBad(f.high) ? "limit" : null;
}

export function kindPayload(f: KindFormState) {
  const low = limitMilli(f.low);
  const high = limitMilli(f.high);
  return {
    name: f.name.trim(),
    unit: f.unit.trim(),
    minMilli: low === "bad" ? null : low,
    maxMilli: high === "bad" ? null : high,
  };
}

/** The words for the limits of a reading kind. */
export function limitWords(min: number | null, max: number | null, text: (m: number) => string, unit: string): Words | null {
  if (min != null && max != null)
    return {
      key: "maint.assets.readings.limitsBoth",
      vars: { min: text(min), max: text(max), unit },
    };
  if (min != null)
    return {
      key: "maint.assets.readings.limitMin",
      vars: { min: text(min), unit },
    };
  if (max != null)
    return {
      key: "maint.assets.readings.limitMax",
      vars: { max: text(max), unit },
    };
  return null;
}

// ---------------------------------------------------------------------------------------------
// The report

export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The last three months, ending with the month of `today`. */
export function defaultRange(today: string): { from: string; to: string } {
  const to = monthOfDay(today);
  return { from: addMonths(to, -2), to };
}

/** Every month from `from` to `to`, oldest first; empty when the range is wrong. */
export function monthsBetween(from: string, to: string): string[] {
  if (!MONTH.test(from) || !MONTH.test(to) || from > to) return [];
  const out: string[] = [];
  for (let m = from; m <= to && out.length <= 60; m = addMonths(m, 1)) out.push(m);
  return out;
}

export type RangeProblem = "bad" | "order" | "long" | null;

export function rangeProblem(from: string, to: string): RangeProblem {
  if (!MONTH.test(from) || !MONTH.test(to)) return "bad";
  if (from > to) return "order";
  return monthsBetween(from, to).length > MAX_MONTHS ? "long" : null;
}

/** Minutes between breakdowns as hours with one decimal ("90" -> "1.5"); empty when there is no figure. */
export function hoursFromMinutes(min: number | null | undefined): string {
  if (min == null) return "";
  const tenths = Math.round(min / 6);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return frac === 0 ? String(whole) : `${whole}.${frac}`;
}

/** Rupees typed as text to whole paise: "250" -> 25000, "99.5" -> 9950; null when empty or not money. */
export function rupeesToPaise(text: string): number | null | "bad" {
  const typed = text.trim();
  if (typed === "") return null;
  const [group = "", ...rest] = typed.split(".");
  if (rest.length > 1) return "bad";
  // Commas only as Indian ("1,25,000") or western ("125,000") thousands groups.
  if (group.includes(",") && !/^(\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})*,\d{3})$/.test(group)) return "bad";
  const t = [group.replace(/,/g, ""), ...rest].join(".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return "bad";
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Paise as plain typed rupees: 25000 -> "250", 9950 -> "99.5"; empty for null. */
export function paiseToRupeesText(paise: number | null | undefined): string {
  if (paise == null) return "";
  const whole = Math.floor(paise / 100);
  const frac = String(paise % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
