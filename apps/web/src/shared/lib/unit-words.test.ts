/**
 * A number and its unit word must agree. On every screen that formats weights or section weights with the
 * plant's `Fmt`, each `t("key", { ... })` call that passes such a number must use a dictionary string whose unit
 * word is a placeholder ({massUnit}, {sectionUnit}), in every language. A string that still says "kg" beside a
 * number in pounds would read wrong for a plant that chose pounds.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";

const DICT: Record<string, unknown> = { en, hi, gu };
/** The dictionary string as written (placeholders intact), English where the language has none. */
function raw(lang: string, key: string): string {
  const get = (d: unknown) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), d);
  const v = get(DICT[lang]);
  const fallback = get(en);
  return typeof v === "string" ? v : typeof fallback === "string" ? fallback : "";
}

const ROOT = join(import.meta.dir, "../..");
const WEIGHT = /\b(kgGrouped[123]|kgPlain3|kgTrim|kgPlainTrim|kgWithUnit)\(fmt/;
const SECTION = /\bsectionText\(fmt|\bsectionOrNull\(fmt|\bbandEndText\(fmt/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

function closeOf(s: string, i: number): number {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i]!;
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth === 0) return i;
    else if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < s.length && s[i] !== q; i++) if (s[i] === "\\") i++;
    }
  }
  return -1;
}

type Use = { file: string; key: string; kind: "mass" | "section" };
function uses(): Use[] {
  const found: Use[] = [];
  const call = /\bt\(\s*"([A-Za-z0-9_.]+)"\s*,\s*\{/g;
  for (const file of sources(ROOT)) {
    const s = readFileSync(file, "utf8");
    if (!s.includes("fmt-text")) continue;
    for (let m = call.exec(s); m; m = call.exec(s)) {
      const body = s.slice(m.index + m[0].length - 1, closeOf(s, m.index + m[0].length - 1) + 1);
      if (WEIGHT.test(body)) found.push({ file: file.slice(ROOT.length + 1), key: m[1]!, kind: "mass" });
      if (SECTION.test(body)) found.push({ file: file.slice(ROOT.length + 1), key: m[1]!, kind: "section" });
    }
  }
  return found;
}

describe("unit words follow the plant's unit", () => {
  const all = uses();
  test("the scan finds the switched calls (so it cannot pass by finding nothing)", () => {
    expect(all.length).toBeGreaterThan(40);
  });
  for (const lang of ["en", "hi", "gu"] as const) {
    test(`${lang}: no switched call uses a string with a bare kg or kg/12ft`, () => {
      const bad: string[] = [];
      for (const u of all) {
        const text = raw(lang, u.key);
        if (text === "") bad.push(`${u.file}: ${u.key} has no string`);
        const stripped = text.replace(/\{[^}]*\}/g, "");
        const bare = u.kind === "mass" ? /\bkg\b(?!\/)/.test(stripped) : /kg\/12ft/.test(stripped);
        if (bare) bad.push(`${u.file}: ${u.key} -> ${text}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
