import type { StatusTone } from "@orrn/domain";
import { parseDecimal } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import { canAny, type Action, type Me } from "@orrn/server/lib/permissions";

import type { DieCopyStatus } from "./search";

export { DIE_COPY_STATUSES, type DieCopyStatus } from "./search";

/**
 * Masters (PL-W1): pure helpers shared by the Masters screens. Numbers travel as integers
 * (percent in basis points, kg/12ft in thousandths of a kg); these turn them into what a person
 * types and back, refusing anything the server would refuse.
 */

export type Parsed = { ok: true; value: number | null } | { ok: false };

const nf = (max: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: max, useGrouping: false });

/** 8850 bp -> "88.5" (what goes back into the field). */
export function bpToPercentInput(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return "";
  return nf(2).format(bp / 100);
}

/** 8850 bp -> "88.5%" for lists; null when not set. */
export function percentText(bp: number | null | undefined): string | null {
  if (bp === null || bp === undefined) return null;
  return `${nf(2).format(bp / 100)}%`;
}

/** "88.5" -> 8850. Blank is "not set"; above 100 or more than two decimals is refused. */
export function parsePercentBp(text: string): Parsed {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t.replace(/,/g, ""))) return { ok: false };
  const n = parseDecimal(t);
  if (n === null || n > 100) return { ok: false };
  return { ok: true, value: Math.round(n * 100) };
}

/** 1842 -> "1.842". */
export function kgPer12ftInput(milli: number | null | undefined): string {
  if (milli === null || milli === undefined) return "";
  return nf(3).format(milli / 1000);
}

/** "1.842" -> 1842 (grams per 12 ft). Above 0, at most 500 kg/12ft, at most three decimals. */
export function parseKgPer12ftMilli(text: string): Parsed {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!/^\d+(\.\d{1,3})?$/.test(t.replace(/,/g, ""))) return { ok: false };
  const n = parseDecimal(t);
  if (n === null || n <= 0 || n > 500) return { ok: false };
  return { ok: true, value: Math.round(n * 1000) };
}

/** A whole number within [min, max]; blank is "not set". Digit grouping commas are fine. */
export function parseWholeNumber(text: string, range: { min: number; max: number }): Parsed {
  const t = text.trim().replace(/,/g, "");
  if (t === "") return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < range.min || n > range.max) return { ok: false };
  return { ok: true, value: n };
}

/** Letters and digits only, lower case: how the server matches vendor names and spellings. */
export function nameKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

type CodeProblem = "required" | "invalid" | null;

/** Location code (stock.locations): letters, digits, dashes, starting with a letter or digit; never 0. */
export function locationCodeProblem(code: string): CodeProblem | "zero" {
  const c = code.trim().toUpperCase();
  if (!c) return "required";
  if (/^0+$/.test(c)) return "zero";
  if (c.length > 20 || !/^[A-Z0-9][A-Z0-9-]*$/.test(c)) return "invalid";
  return null;
}

/** Scrap grade code (purchase.scrapGrades): 1 to 8 letters, digits, + or -. */
export function gradeCodeProblem(code: string): CodeProblem {
  const c = code.trim();
  if (!c) return "required";
  return /^[A-Za-z0-9+-]{1,8}$/.test(c) ? null : "invalid";
}

/** Return stream code (foundry.returnStreams): 1 to 20 letters, digits and dashes. */
export function streamCodeProblem(code: string): CodeProblem {
  const c = code.trim();
  if (!c) return "required";
  return /^[A-Za-z0-9-]{1,20}$/.test(c) ? null : "invalid";
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Blank = unregistered vendor; otherwise the 15-character GSTIN pattern (upper-cased first). */
export function gstinProblem(text: string): "invalid" | null {
  const g = text.trim().toUpperCase();
  if (!g) return null;
  return GSTIN_RE.test(g) ? null : "invalid";
}

/** "Other spellings" typed one per line: trimmed, blanks and same-key repeats dropped. */
export function spellingsFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    const key = nameKey(s);
    if (!s || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Words most scrap vendors carry; a duplicate search on them finds everyone. */
const COMMON_NAME_WORDS = new Set([
  "shree",
  "shri",
  "sri",
  "metal",
  "metals",
  "steel",
  "corporation",
  "corp",
  "company",
  "co",
  "enterprise",
  "enterprises",
  "industries",
  "industry",
  "trading",
  "and",
  "the",
  "llc",
  "ltd",
  "pvt",
  "private",
  "limited",
  "sons",
]);

/**
 * The word to start a duplicate search with: the longest word of the name that is not one every
 * second vendor has ("Shree Ganesh Metals" -> "Ganesh"). Falls back to the longest word.
 */
export function mergeSearchSeed(name: string): string {
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  if (words.length === 0) return name.trim();
  const telling = words.filter((w) => w.length >= 3 && !COMMON_NAME_WORDS.has(w.toLowerCase()));
  const pool = telling.length > 0 ? telling : words;
  return pool.reduce((best, w) => (w.length > best.length ? w : best), pool[0]!);
}

/** One row of `stock.byLocation` totals, as the client sees it. */
export type LocationTotal =
  | { itemKind: "bundle" | "scrap_grade" | "return_stream" | "billet"; itemCount: number; qtyG: number }
  | { itemKind: "store_item"; itemCount: number; qtyG: null };

/** What a location holds: bundles, kg of everything weighed in kg, and store items (other units). */
export function holdsSummary(totals: readonly LocationTotal[]) {
  let bundles = 0;
  let kgG = 0;
  let storeItems = 0;
  for (const t of totals) {
    if (t.itemKind === "store_item") {
      storeItems += t.itemCount;
      continue;
    }
    if (t.itemKind === "bundle") bundles += t.itemCount;
    kgG += t.qtyG;
  }
  return { bundles, kgG, storeItems, empty: bundles === 0 && kgG === 0 && storeItems === 0 };
}

export type StatusView = { tone: StatusTone | null; key: MessageKey };

export type VendorStatus = "draft" | "active" | "archived" | "merged";

/** A live vendor reads as plain text; the rest carry a chip with the word. */
export function vendorStatusView(status: VendorStatus): StatusView {
  switch (status) {
    case "draft":
      return { tone: "amber", key: "vendors.status.draft" };
    case "archived":
      return { tone: "neutral", key: "vendors.status.archived" };
    case "merged":
      return { tone: "neutral", key: "vendors.status.merged" };
    default:
      return { tone: null, key: "vendors.status.active" };
  }
}


/** Green = ready to run, blue = on the press, amber = away (nitriding, die maker) or on trial, neutral = retired. */
export function dieCopyStatusView(status: DieCopyStatus): StatusView {
  const tone: Record<DieCopyStatus, StatusTone> = {
    available: "green",
    in_use: "blue",
    at_nitriding: "amber",
    at_maker: "amber",
    on_trial: "amber",
    retired: "neutral",
  };
  return { tone: tone[status], key: `masters.dieCopies.status.${status}` as MessageKey };
}

export type LocationKind = "yard" | "billet_store" | "scrap_store" | "store" | "wip";
export const LOCATION_KINDS: readonly LocationKind[] = ["yard", "billet_store", "scrap_store", "store", "wip"];

export type StreamKind = "charge" | "byproduct";
export const STREAM_KINDS: readonly StreamKind[] = ["charge", "byproduct"];

export type ErrorView = { key: MessageKey; vars?: Record<string, string> };

/**
 * Server messages (English, from the masters routers) as i18n keys, so a Hindi screen never shows
 * an English error. Unknown messages get a plain generic line; the person can try again.
 */
export function masterErrorKey(error: unknown): ErrorView {
  if (!error || typeof error !== "object") return { key: "masters.errors.generic" };
  const message = error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? "");
  const code = (error as { data?: { code?: string } | null }).data?.code;
  let m: RegExpMatchArray | null;
  if ((m = message.match(/^That name is already used by (.+)$/))) {
    return m[1] === "another vendor" ? { key: "vendors.errors.nameTakenOther" } : { key: "vendors.errors.nameTaken", vars: { name: m[1]! } };
  }
  if (/spelling already belongs/.test(message)) return { key: "vendors.errors.spellingTaken" };
  if (/already the vendor's name/.test(message)) return { key: "vendors.errors.spellingIsName" };
  if ((m = message.match(/^Location (\S+) already exists/))) return { key: "masters.locations.errors.codeTaken", vars: { code: m[1]! } };
  if ((m = message.match(/^Location (\S+) still holds stock/))) return { key: "masters.locations.errors.notEmpty", vars: { code: m[1]! } };
  if (/scrap item already exists/.test(message)) return { key: "masters.scrap.errors.itemTaken" };
  if (/grade already exists/.test(message)) return { key: "masters.scrap.errors.gradeTaken" };
  if (/return stream with that code or name exists/.test(message)) return { key: "masters.streams.errors.taken" };
  if (/Confirm this vendor before merging/.test(message)) return { key: "vendors.errors.confirmKeeperFirst" };
  if (/already merged/.test(message)) return { key: "vendors.errors.alreadyMerged" };
  if (/merged into another one/.test(message)) return { key: "vendors.errors.wasMerged" };
  if (/^Keep a live vendor/.test(message)) return { key: "vendors.errors.keepLive" };
  if (/section is archived/.test(message)) return { key: "masters.dieCopies.errors.sectionArchived" };
  if (/changed; try again/.test(message)) return { key: "masters.errors.changed" };
  if (code === "FORBIDDEN") return { key: "masters.errors.forbidden" };
  if (code === "NOT_FOUND") return { key: "masters.errors.notFound" };
  return { key: "masters.errors.generic" };
}

/** Who may read scrap vendors (rates are commercial): the server's `purchaseReader`. */
export const PURCHASE_READERS: readonly Action[] = ["purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish"];
/** Store item master holders (ruling RP19) and the Store nav gate (PL-W6). */
export const STORE_ITEM_PEOPLE: readonly Action[] = ["store.txn", "masters.publish"];
/** Die card fields: the die room or masters publishers (ruling RP7). */
export const DIE_CARD_EDITORS: readonly Action[] = ["die.card", "masters.publish"];

export type MasterKey = "vendors" | "scrap" | "storeItems" | "locations" | "sections" | "dieCopies" | "reasons";

export type MasterEntry = {
  key: MasterKey;
  group: "buying" | "floor";
  to: string;
  titleKey: MessageKey;
  hintKey: MessageKey;
  requires?: readonly Action[];
};

/**
 * The masters a person can open, in page order. Reason codes join once the press module ships its
 * master (PL-9); store items live on the Store screens (ruling PLW6) and sections on /dies.
 */
const ENTRIES: readonly MasterEntry[] = [
  { key: "vendors", group: "buying", to: "/vendors", titleKey: "masters.hub.vendors", hintKey: "masters.hub.vendorsHint", requires: PURCHASE_READERS },
  { key: "scrap", group: "buying", to: "/masters/scrap", titleKey: "masters.hub.scrap", hintKey: "masters.hub.scrapHint" },
  { key: "storeItems", group: "buying", to: "/store/items", titleKey: "masters.hub.storeItems", hintKey: "masters.hub.storeItemsHint", requires: STORE_ITEM_PEOPLE },
  { key: "locations", group: "floor", to: "/masters/locations", titleKey: "masters.hub.locations", hintKey: "masters.hub.locationsHint" },
  { key: "sections", group: "floor", to: "/dies", titleKey: "masters.hub.sections", hintKey: "masters.hub.sectionsHint" },
  { key: "dieCopies", group: "floor", to: "/masters/dies", titleKey: "masters.hub.dieCopies", hintKey: "masters.hub.dieCopiesHint" },
  { key: "reasons", group: "floor", to: "/masters/reasons", titleKey: "masters.hub.reasons", hintKey: "masters.hub.reasonsHint" },
];

export function masterEntries(me: Me | null | undefined): MasterEntry[] {
  return ENTRIES.filter((e) => !e.requires || canAny(me, e.requires));
}

/** "2026-10-04" as "4 Oct" (the plant's current year) or "31 Dec 2025". `today` is the company's day. */
export function formatDay(iso: string, today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const sameYear = today.slice(0, 4) === m[1];
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(date);
}

/** Paise as rupees with two decimals: 19850 -> "198.50". */
export function rupeesPerKg(paise: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);
}
