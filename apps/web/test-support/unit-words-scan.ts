/**
 * Scan used by the unit-words guard test: which dictionary strings the web app can show beside a plant's number, and
 * which of them still carry a bare unit word. Test-only (reads source files).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";

export const SRC = join(import.meta.dir, "../src");
const DICT: Record<string, unknown> = { en, hi, gu };

/**
 * Keys that may say a fixed unit on purpose, each with the reason. A prefix covers every key under it.
 * Anything not listed here must use {massUnit}, {sectionUnit} or {lengthUnit} (or carry the figure with its unit already).
 */
export const FIXED_UNIT_KEYS: { prefix: string; why: string }[] = [
  { prefix: "units.", why: "the unit words themselves (and the names in the pickers)" },
  { prefix: "settings.", why: "Settings names the units it lets a plant choose" },
  { prefix: "packingList.", why: "the packing list view mirrors the paper, which keeps kg and feet and inches until the paper has its own setting" },
  { prefix: "dispatch.pl", why: "packing list revisions mirror the paper" },
  { prefix: "foundry.melt.ldo", why: "the LDO tank dip is a gauge in inches ('Inches stay inches')" },
  { prefix: "foundry.yield.note", why: "the LDO note names inches of tank dip" },
  { prefix: "press.console.billetsLeft", why: "a server refusal sentence quoting the store in kg" },
  { prefix: "press.console.errors.billetsLeft", why: "a server refusal sentence quoting the store in kg" },
  { prefix: "press.console.pickOrderLine", why: "a server refusal sentence quoting the cut length in mm" },
  { prefix: "store.unitShort.", why: "the item's own unit word (kilogram items show the plant's unit through unitShort)" },
  { prefix: "store.unitName.", why: "the item's own unit name in the item picker" },
  { prefix: "printing.", why: "label media is measured in mm on the printer" },
  { prefix: "labelSheet.", why: "label media is measured in mm on the printer" },
  { prefix: "imports.", why: "import columns are matched by their written units" },
  { prefix: "ingest.", why: "import portal" },
  { prefix: "refusal.", why: "server English sentences mapped for the screen" },
  { prefix: "errors.", why: "server sentences mapped for the screen" },
  { prefix: "marketing.", why: "public pages" },
  { prefix: "landing.", why: "public pages" },
  { prefix: "auth.", why: "sign in" },
  { prefix: "platform.", why: "platform staff screens, not a plant's" },
  { prefix: "admin.", why: "platform staff screens, not a plant's" },
  { prefix: "native.", why: "the phone app stays on today's units until its own release" },
  { prefix: "guides.", why: "guide pages are prose" },
  { prefix: "collectors.", why: "machine data units (bar, mm/s)" },
  { prefix: "devices.collectors", why: "machine data units (mm/s, bar)" },
  { prefix: "press.alerts.unit", why: "machine data units (mm/s)" },
  { prefix: "purchase.errors.rate", why: "a rate is rupees per kg; the rate's basis is not a plant choice" },
  { prefix: "purchase.charts.rate", why: "a rate is rupees per kg" },
  { prefix: "purchase.new.rate", why: "a rate is rupees per kg" },
  { prefix: "purchase.new.usualPick", why: "a rate is rupees per kg" },
  { prefix: "purchase.detail.perKg", why: "a rate is rupees per kg" },
  { prefix: "purchase.detail.amountHint", why: "an amount is weight times a rate per kg" },
  { prefix: "foundry.cast.cost.perKg", why: "a cost per kg of billet is a rate" },
  { prefix: "masters.scrap.form.recoveryHint", why: "recovery is a share of 100 kg, a ratio" },
  { prefix: "foundry.masters.diaInvalid", why: "a validation range written in mm (25 to 500)" },
  { prefix: "ageing.split.hint", why: "the 25 mm tolerance is a rule written in mm" },
  { prefix: "portal.orders.lengthHintInch", why: "describes the feet and inches form, shown only to a feet and inches plant" },
  { prefix: "pack.new.cutLengthHintInch", why: "describes the feet and inches form" },
  { prefix: "orders.form.lengthHintInch", why: "describes the feet and inches form" },
  { prefix: "orders.line.lengthHintInch", why: "describes the feet and inches form" },
  { prefix: "press.collector", why: "machine data units" },
];

export function isFixedOk(key: string): boolean {
  return FIXED_UNIT_KEYS.some((f) => key.startsWith(f.prefix));
}

export function raw(lang: string, key: string): string {
  const get = (d: unknown) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), d);
  const v = get(DICT[lang]);
  const fallback = get(en);
  return typeof v === "string" ? v : typeof fallback === "string" ? fallback : "";
}

function leaves(o: unknown, prefix = "", out: string[] = []): string[] {
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  else if (typeof o === "string") out.push(prefix);
  return out;
}
const ALL_KEYS = new Set(leaves(en));
const KEY_LIST = [...ALL_KEYS];

function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (p.endsWith("features/ingest")) continue;
      sources(p, out);
    } else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}

/** Every dictionary key the web source can reach: a quoted key, or a template family `prefix.${x}` (all leaves under it). */
export function referencedKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const add = (k: string, file: string) => {
    const a = found.get(k) ?? [];
    if (!a.includes(file)) a.push(file);
    found.set(k, a);
  };
  for (const file of sources(SRC)) {
    const s = readFileSync(file, "utf8");
    const rel = file.slice(SRC.length + 1);
    for (const m of s.matchAll(/["'`]([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)["'`]/g)) if (ALL_KEYS.has(m[1]!)) add(m[1]!, rel);
    for (const m of s.matchAll(/`([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\.\$\{/g)) {
      const prefix = `${m[1]!}.`;
      for (const k of KEY_LIST) if (k.startsWith(prefix)) add(k, rel);
    }
  }
  return found;
}

// "12 ft" is the name of the standard section length ("weight per 12 ft"), not a unit shown beside a plant figure.
const BARE = /(?<![\w{/])kg(?![\w}])|kg\/12ft|kg\/m\b|(?<![\w{])mm(?![\w}])|(?<![\w{\d] ?)ft(?![\w}])/;

/** Strings (per language) that still say a bare unit word and are not on the fixed list. */
export function bareUnitStrings(lang: string): { key: string; text: string; files: string[] }[] {
  const out: { key: string; text: string; files: string[] }[] = [];
  for (const [key, files] of referencedKeys()) {
    if (isFixedOk(key)) continue;
    const text = raw(lang, key);
    const stripped = text.replace(/\{[^}]*\}/g, "");
    if (BARE.test(stripped)) out.push({ key, text, files });
  }
  return out;
}
