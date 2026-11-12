import { describe, expect, test } from "bun:test";

import { builtinBundles, builtinCustomers, builtinDies } from "./builtins";
import { fitBuiltin } from "./fit";
import { fingerprint, normalizeHeader } from "./fingerprint";
import { WEB_TEMPLATE_CSV } from "./builtins/web-templates.fixture";
import { parseCsv } from "./readers/csv";
import { DIE_SHEET_HEADERS } from "./recipe-fixtures";

// Round 6, item 2 (M-R5-3, owner's decision): signs that carry meaning are kept, count words are not folded together,
// and only spelling variants of one unit fold.

/** Names in one group share a key; names in different groups never do. */
const GROUPS: string[][] = [
  ["Kg", "kgs", "Kg.", "kilogram", "KILOGRAMS", "Kilo"],
  ["Pcs", "pc", "piece", "Pieces", "Pcs."],
  ["No", "Nos", "No.", "NOS"],
  ["Tol +", "TOL+", "tol (+)"],
  ["Tol -", "tol -", "Tol (-)", "Tol −"],
  ["Rate %", "rate%", "Rate (%)"],
  ["Rate", "RATE", "Rate:", " rate "],
  ["Order #", "order#"],
  ["Order", "Order."],
  ["Kg (+)"],
  ["Kg (-)"],
  ["Bundle Nos", "Bundle No.", "bundle no"],
  ["Bundle Pcs", "Bundle Pieces"],
  ["#"],
  ["%"],
  ["-"],
  [""],
  ["Sr No", "Sr-No", "SR. NO."],
  ["Wt (kg)", "Wt kg.", "WT KGS"],
  ["Party"],
  ["Party Name"],
  ["नाम"],
  ["નામ"],
];

describe("round 6: the normaliser keeps meaning", () => {
  test("names of one group share a key, and every two groups differ", () => {
    const keys = GROUPS.map((g) => {
      const ks = new Set(g.map(normalizeHeader));
      expect([...ks], g.join(" | ")).toHaveLength(1);
      return [...ks][0]!;
    });
    expect(new Set(keys).size).toBe(GROUPS.length);
  });

  test("random pairs of different names never share a key (20,000 pairs, three scripts, the near pairs included)", () => {
    let s = 17;
    const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const letters = ["abcdefghijklmnopqrstuvwxyz", "कखगघचछजझटठडढतथदधनपफबभमयरलवशसह", "કખગઘચછજઝટઠડઢતથદધનપફબભમયરલવશસહ"];
    const word = () => {
      const a = [...letters[Math.floor(r() * 3)]!];
      return Array.from({ length: 2 + Math.floor(r() * 5) }, () => a[Math.floor(r() * a.length)]).join("");
    };
    const signs = ["", " +", " -", " %", " #", " (+)", " (-)"];
    const named = new Map<string, number>();
    GROUPS.forEach((g, i) => g.forEach((n) => named.set(n, i)));
    const pool: [string, string][] = GROUPS.flatMap((g, i) => g.map((n) => [n, `g${i}`] as [string, string]));
    for (let i = 0; i < 400; i++) {
      const w = word();
      const sign = signs[Math.floor(r() * signs.length)]!;
      // A random word is its own name; the same word with another sign is another name.
      pool.push([`${w}${sign}`, `w:${w}:${sign.replace(/[ ()]/g, "")}`]);
      pool.push([`${w.toUpperCase()}${sign}`, `w:${w}:${sign.replace(/[ ()]/g, "")}`]);
    }
    for (let i = 0; i < 20000; i++) {
      const [a, ga] = pool[Math.floor(r() * pool.length)]!;
      const [b, gb] = pool[Math.floor(r() * pool.length)]!;
      // Random Latin words may spell a unit word ("kg", "no"): those are left out.
      if (ga.startsWith("w:") && /^w:(kgs?|kilos?|kilograms?|pcs?|pieces?|nos?|m|ft|rs|inr|mtrs?|meters?|metres?|feet|foot)(:|$)/.test(ga)) continue;
      if (gb.startsWith("w:") && /^w:(kgs?|kilos?|kilograms?|pcs?|pieces?|nos?|m|ft|rs|inr|mtrs?|meters?|metres?|feet|foot)(:|$)/.test(gb)) continue;
      expect(normalizeHeader(a) === normalizeHeader(b), `${JSON.stringify(a)} ${JSON.stringify(b)}`).toBe(ga === gb);
    }
    expect(named.size).toBeGreaterThan(50);
  });

  test("the web's old templates are still exact built-in fits", () => {
    const fits = (headers: readonly string[], hole: Parameters<typeof fitBuiltin>[1], row: string[]) => fitBuiltin(fingerprint({ headers, rows: [row, row] }), hole);
    expect(fits(DIE_SHEET_HEADERS, builtinDies, ["40", "4012", "2.2", "2.5", "Frame", "44.5", "1.2", "", "active", ""])?.fit).toBe("exact");
    // Round 7, rule 6.4: the bundle template exactly as the web hands it out, with no column added by this test
    // (it had a hand-added "Legacy id" column). See also builtins/templates-r7.test.ts.
    const bundle = fits(parseCsv(WEB_TEMPLATE_CSV.bundles.inch)[0]!, builtinBundles, ["40", "4012", "25", "58.4", "12", "PO-2611"]);
    expect(bundle?.fit).toBe("exact");
    // The one stored-key change of round 6: "Pieces" is now "pcs" (it was "pieces").
    expect(bundle!.recipe.match.headers).toEqual(["die series", "section code", "pcs", "weight kg", "length ft", "po number"]);
    expect(fits(["Name", "Phone", "Email", "GSTIN", "Notes"], builtinCustomers, ["Om", "98250", "a@b.in", "24AB", "ok"])?.fit).toBe("exact");
  });
});
