/**
 * A number and its unit word must agree. Any dictionary string the web app can show (a quoted key, or a family chosen at
 * run time) must not say a bare kg, kg/12ft, kg/m, mm or ft: it says {massUnit}, {sectionUnit} or {lengthUnit}, which the
 * plant's `FmtProvider` fills for every t() call, or it is on the fixed list with its reason (`FIXED_UNIT_KEYS`).
 * It also still checks the older rule: a t(key, { ... }) call that passes a weight from the plant's formatter uses a
 * string with a unit placeholder.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { bareUnitStrings, FIXED_UNIT_KEYS, raw, referencedKeys, SRC } from "../../../test-support/unit-words-scan";

describe("unit words follow the plant's unit", () => {
  test("the scan reaches a real set of keys (it cannot pass by finding nothing)", () => {
    expect(referencedKeys().size).toBeGreaterThan(1000);
    expect(FIXED_UNIT_KEYS.every((f) => f.why.length > 5)).toBe(true);
  });
  for (const lang of ["en", "hi", "gu"] as const) {
    test(`${lang}: no string a screen can show says a bare kg, kg/12ft, mm or ft`, () => {
      expect(bareUnitStrings(lang).map((b) => `${b.key} -> ${b.text}`)).toEqual([]);
    });
  }
});

describe("calls that pass a weight from the formatter", () => {
  const WEIGHT = /\b(kgGrouped[0123]|kgPlain3|kgTrim|kgPlainTrim|kgWithUnit)\(fmt/;
  const SECTION = /\bsectionText\(fmt|\bsectionOrNull\(fmt|\bbandEndText\(fmt/;
  function files(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) files(p, out);
      else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
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
  test("each such string has a unit placeholder or no unit word", () => {
    const bad: string[] = [];
    const call = /\bt\(\s*"([A-Za-z0-9_.]+)"\s*,\s*\{/g;
    let seen = 0;
    for (const file of files(SRC)) {
      const s = readFileSync(file, "utf8");
      for (let m = call.exec(s); m; m = call.exec(s)) {
        const body = s.slice(m.index + m[0].length - 1, closeOf(s, m.index + m[0].length - 1) + 1);
        const mass = WEIGHT.test(body);
        const section = SECTION.test(body);
        if (!mass && !section) continue;
        seen++;
        for (const lang of ["en", "hi", "gu"]) {
          const stripped = raw(lang, m[1]!).replace(/\{[^}]*\}/g, "");
          if ((mass && /(?<![\w/])kg(?![\w/])/.test(stripped)) || (section && /kg\/12ft/.test(stripped))) bad.push(`${file.slice(SRC.length + 1)}: ${m[1]} (${lang})`);
        }
      }
    }
    expect(seen).toBeGreaterThan(40);
    expect(bad).toEqual([]);
  });
});
