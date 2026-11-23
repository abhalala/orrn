import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import { gu } from "@orrn/i18n/gu";
import { GODSEYE_MORE, GODSEYE_NAV, TENANT_MORE, TENANT_PRIMARY } from "../nav-items";
import { PAGE_ALIASES, PAGE_SECTIONS } from "./page-index";
import { matchItem, rankItems, type Searchable } from "./search";

type Tree = { readonly [key: string]: unknown };

function flatten(tree: Tree, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else if (value && typeof value === "object") flatten(value as Tree, path, out);
  }
  return out;
}

const EN = flatten(en as Tree);
const ALL_TEXT = [hi, gu].map((d) => [...flatten(d as Tree).values()].join("\n")).join("\n");
const TENANT = [...TENANT_PRIMARY, ...TENANT_MORE];
const NAV_KEYS = new Set([...TENANT, ...GODSEYE_NAV, ...GODSEYE_MORE].map((i) => i.key));

/** `to` paths the router knows (index routes without the trailing slash), read from the generated route tree. */
function routePaths(): Set<string> {
  const src = readFileSync(join(import.meta.dir, "../../routeTree.gen.ts"), "utf8");
  const block = src.slice(src.indexOf("export interface FileRoutesByTo"));
  const body = block.slice(0, block.indexOf("\n}"));
  return new Set([...body.matchAll(/^\s+'([^']+)':/gm)].map((m) => m[1] as string));
}
const ROUTES = routePaths();

const DEVANAGARI = /[ऀ-ॿ]/;
const GUJARATI = /[઀-૿]/;

function pageItem(key: string): Searchable {
  const nav = TENANT.find((i) => i.key === key)!;
  return { id: key, group: "pages", label: EN.get(nav.labelKey)!, aliases: PAGE_ALIASES[key] };
}

describe("PAGE_ALIASES", () => {
  test("keys are nav item keys", () => {
    for (const key of Object.keys(PAGE_ALIASES)) expect(NAV_KEYS.has(key)).toBe(true);
  });
  test("no empty or duplicate aliases", () => {
    for (const [key, words] of Object.entries(PAGE_ALIASES)) {
      expect(words.every((w) => w.trim().length > 0)).toBe(true);
      expect(new Set(words.map((w) => w.toLowerCase())).size).toBe(words.length);
      expect(key).toBeTruthy();
    }
  });
  test("every Hindi or Gujarati alias is taken from a dictionary", () => {
    const words = [...Object.values(PAGE_ALIASES), ...PAGE_SECTIONS.map((s) => s.terms)].flat();
    for (const w of words) {
      if (DEVANAGARI.test(w) || GUJARATI.test(w)) expect({ w, found: ALL_TEXT.includes(w) }).toEqual({ w, found: true });
    }
  });
  test("plant words find the right page", () => {
    const cases: [string, string][] = [
      ["challan", "dispatch"],
      ["packing list", "dispatch"],
      ["party", "customers"],
      ["billet", "foundry"],
      ["furnace", "foundry"],
      ["oven", "ageing"],
      ["aging", "ageing"],
      ["bolster", "dies"],
      ["QR", "printing"],
      ["excel", "ingest"],
      ["kanta", "purchase"],
      ["order book", "orders"],
      ["anodise", "jobwork"],
      ["powder coat", "jobwork"],
      ["draw bench", "drawbench"],
      ["cnc", "fabrication"],
    ];
    const pages = TENANT.map((i) => pageItem(i.key));
    for (const [q, key] of cases) {
      const top = rankItems(q, pages)[0];
      expect({ q, top: top?.id }).toEqual({ q, top: key });
    }
  });
  test("Hindi and Gujarati words find pages, with the matched word", () => {
    const hiWord = (PAGE_ALIASES.dies ?? []).find((w) => DEVANAGARI.test(w));
    const guWord = (PAGE_ALIASES.dies ?? []).find((w) => GUJARATI.test(w));
    expect(hiWord).toBeDefined();
    expect(guWord).toBeDefined();
    expect(matchItem(hiWord!, pageItem("dies"))?.matched).toBe(hiWord!);
    expect(matchItem(guWord!, pageItem("dies"))?.matched).toBe(guWord!);
  });
});

describe("PAGE_SECTIONS", () => {
  test("ids are unique", () => {
    expect(new Set(PAGE_SECTIONS.map((s) => s.id)).size).toBe(PAGE_SECTIONS.length);
  });
  test("every parentKey is a nav item key", () => {
    for (const s of PAGE_SECTIONS) expect({ id: s.id, ok: NAV_KEYS.has(s.parentKey) }).toEqual({ id: s.id, ok: true });
  });
  test("every `to` is a real route path", () => {
    for (const s of PAGE_SECTIONS) expect({ id: s.id, to: s.to, ok: ROUTES.has(s.to) }).toEqual({ id: s.id, to: s.to, ok: true });
  });
  test("every labelKey exists in the English dictionary", () => {
    for (const s of PAGE_SECTIONS) {
      if (s.labelKey) expect({ id: s.id, key: s.labelKey, ok: EN.has(s.labelKey) }).toEqual({ id: s.id, key: s.labelKey, ok: true });
      else expect({ id: s.id, label: !!s.label }).toEqual({ id: s.id, label: true });
    }
  });
  test("brief examples are present", () => {
    const ids = new Set(PAGE_SECTIONS.map((s) => s.id));
    for (const id of ["masters.alloys", "dies.issues", "dies.makers", "ageing.load", "ageing.history", "jobwork.new", "orders.plan", "press.alerts"]) {
      expect({ id, ok: ids.has(id) }).toEqual({ id, ok: true });
    }
  });
  test("a section term reports the matched word", () => {
    const alloys = PAGE_SECTIONS.find((s) => s.id === "masters.alloys")!;
    const item: Searchable = { id: alloys.id, group: "sections", label: EN.get(alloys.labelKey!) ?? alloys.label!, terms: alloys.terms };
    const term = alloys.terms[0]!;
    if (term.toLowerCase() !== item.label.toLowerCase()) expect(matchItem(term, item)?.matched).toBe(term);
  });
});
