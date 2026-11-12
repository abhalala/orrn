import { describe, expect, test } from "bun:test";

import { BUILTIN_HOLES } from "./builtins";
import { readHeader } from "./builtins/aliases";
import { normalizeHeader } from "./fingerprint";

// Round 8, rule 8.2: more spellings of one name. "per" between two words is "/"; a space between a number and a unit
// word does not matter, and after a number a prime is ft and a double prime is in; single letters separated by dots or
// spaces join; a sign in brackets or alone before a word is kept. The families and near pairs carry every spelling in
// PORTAL-R4-CHECK.md rounds 6 and 7 (M-R6-2, M-R6-3, the round 6 minors, M-R7-3, M-R7-4) and the checker's r7f.ts.

const FAMILIES: string[][] = [
  // M-R7-3: the plant's die weight unit, written every way.
  ["Kg/12ft", "Kg / 12ft", "kg/12 ft", "Kg/12 Ft.", "Kg per 12 ft", "Kg/12'", "kg/12 feet", "KG/12FT", "Kg/12′", "Kg-12ft", "kg 12 ft"],
  ["Wt Kg/12ft", "Wt (Kg/12 ft)", "Wt kg per 12 ft", "WT. KG/12'"],
  ["Rate/Kg", "Rate / Kg", "Rate per Kg", "RATE PER KG", "Rate Kg"],
  ["Rate (Rs/Kg)", "Rate Rs/Kg", "Rate ₹/kg", "Rate Rs per Kg"],
  ["PO No", "P.O. No", "P.O. No.", "PO No.", "P/O No", "P. O. No", "P O No"],
  ["S No", "S. No.", "S.No.", "S/No", "S-No", "S. No"],
  ["Sr No", "Sr. No.", "SR.NO", "Sr-No", "Sr.No:", "Sr No."],
  ["Size 12in", "Size 12\"", "Size 12 in", "Size 12″", "Size 12''"],
  ["Length 3660mm", "Length 3660 mm", "Length (3660 mm)"],
  // M-R6-2 and r7f.
  ["Wt (kg)", "Wt. (Kg)", "WT KG", "Wt-Kg", "Wt - Kg", "Wt – Kg", "Wt:Kg", "Wt kg.", "Wt Kg", "Ｗｔ Ｋｇ", "Wt (Kgs)", "Wt (kilograms)", "Wt.-Kg", "Wt‐Kg"],
  ["Min - Max", "Min-Max", "Min – Max", "Min — Max", "Min/Max", "Min Max"],
  ["Cut Length (ft)", "Cut length ft", "Cut Length (Feet)", "Cut-Length (ft)", "Cut Length - ft", "Cut Length(ft.)"],
  ["Qty (Pcs)", "Qty Pcs", "Qty.(Pcs)", "Qty - Pcs", "Qty (pieces)", "Qty (pc)"],
  // Round 6 minor: an apostrophe is feet only after a number; "No's" is "Nos", "KG's" is "Kgs".
  ["Qty (Nos)", "Qty Nos", "Qty (No.)", "Qty. (Nos.)", "Qty (No's)"],
  ["Kg", "KG's", "Kgs", "Kg."],
  ["Party Name", "Party name:", "PARTY NAME", "Party Name", "Party  Name", "Party_Name", "Party-Name"],
  ["Bundle No", "Bundle No.", "Bundle-No"],
  // M-R6-3 and M-R7-4: signs.
  ["Tol +", "Tol (+)", "Tol(+)", "TOL +", "Tol. +"],
  ["Tol -", "Tol (-)", "Tol(-)", "Tol (–)", "Tol −", "Tol (‑)", "Tol ‐"],
  ["Tol ±", "Tol±", "TOL (±)"],
  ["Tol +/-", "Tol + / -", "Tol (+/-)"],
  ["Kg -", "Kg (-)", "Kg (–)", "Kg (‐)", "KG (−)"],
  ["- Kg", "(-) Kg", "( - ) Kg", "(–) Kg", "−Kg"],
  ["+ Kg", "(+) Kg", "( + ) Kg"],
  // A bracketed sign is kept; a spaced dash between two words is a separator ("Tol - Kg" is "Tol Kg", M-R6-2).
  ["Tol (-) Kg", "Tol (–) Kg", "Tol ( - ) Kg"],
  ["Tol Kg", "Tol - Kg", "Tol-Kg"],
  ["- Wastage", "-Wastage", "– Wastage", "(-) Wastage"],
  ["Wastage"],
  ["Less -", "Less (-)", "Less (−)"],
  ["Less wt", "Less Wt.", "LESS WT"],
  ["- Less wt", "(-) Less wt", "(−) Less Wt."],
  ["Rate %", "Rate(%)", "Rate (%)", "Rate%"],
  [">12ft", "> 12ft", "> 12 ft", ">12'"],
  ["<12ft", "< 12ft", "< 12 ft"],
  ["Order #", "Order#", "ORDER (#)"],
  // Indian scripts.
  ["नाम", "नाम।", "नाम:", "नाम ।", " नाम "],
  ["वज़न", "वज़न", "वज़न।"],
  ["वजन (किलो)", "वजन(किलो)", "वजन - किलो", "वजन-किलो"],
  ["પાર્ટી નું નામ", "પાર્ટી નું નામ:", "પાર્ટી  નું  નામ", "પાર્ટી નું નામ।"],
  ["વજન (કિ.ગ્રા.)", "વજન (કિ. ગ્રા.)", "વજન કિ.ગ્રા."],
];

/** Near pairs that must differ (M-R6-3, M-R7-4, r7f.ts). */
const NEAR: [string, string][] = [
  ["Tol +", "Tol -"],
  ["Kg (+)", "Kg (-)"],
  ["Kg (-)", "Kg"],
  ["(-) Kg", "Kg"],
  ["(+) Kg", "Kg"],
  ["(-) Kg", "(+) Kg"],
  ["Tol (-) Kg", "Tol Kg"],
  ["Less (-)", "Less"],
  ["- Wastage", "Wastage"],
  ["(-) Less wt", "Less wt"],
  ["Rate %", "Rate"],
  ["Order #", "Order"],
  [">12ft", "<12ft"],
  ["≤ 12", "12"],
  ["Tol ±", "Tol"],
  ["Pcs", "Nos"],
  ["Kg", "Kg/12ft"],
  ["Wt kg", "Wt kg/12ft"],
  ["Weight", "Weight +"],
  ["Min", "Max"],
  ["Kg-12", "Kg -12"],
  ["Size -12", "Size 12"],
  ["Temp -5", "Temp 5"],
  ["Tol +/-", "Tol"],
  ["+/-", ""],
  ["Net", "Net +"],
  ["Dr", "Cr"],
  ["Rate (Excl)", "Rate (Incl)"],
  ["वज़न", "वजन"],
  ["क्‍ष", "क्ष"],
  ["Rs", "Rs %"],
  ["Amount (-)", "Amount"],
  ["Dispatched (–)", "Dispatched"],
  ["Size 12in", "Size 12ft"],
  ["Rate/Kg", "Rate (Rs/Kg)"],
  ["Per Kg", "Kg"],
  ["S No", "Sr No"],
];

describe("8.2: names, more spellings", () => {
  test("every family shares one key, and no two families share a key", () => {
    const seen = new Map<string, number>();
    FAMILIES.forEach((f, i) => {
      const ks = [...new Set(f.map(normalizeHeader))];
      expect(ks, JSON.stringify(f.map((x) => [x, normalizeHeader(x)]))).toHaveLength(1);
      const k = ks[0]!;
      expect(seen.has(k), `${JSON.stringify(f)} shares "${k}" with ${JSON.stringify(FAMILIES[seen.get(k) ?? 0])}`).toBe(false);
      seen.set(k, i);
    });
  });

  test("the near pairs differ", () => {
    for (const [a, b] of NEAR) expect(normalizeHeader(a), `${a} | ${b}`).not.toBe(normalizeHeader(b));
  });

  test("the rules, one by one", () => {
    expect(normalizeHeader("Rate per Kg")).toBe("rate kg");
    expect(normalizeHeader("Kg per 12 ft")).toBe("kg 12ft");
    expect(normalizeHeader("Per Kg")).toBe("per kg"); // "per" not between two words stays
    expect(normalizeHeader("12 ft")).toBe("12ft");
    expect(normalizeHeader("Kg/12'")).toBe("kg 12ft");
    expect(normalizeHeader('Size 12"')).toBe("size 12in");
    expect(normalizeHeader("KG's")).toBe("kg");
    expect(normalizeHeader("P. O. No")).toBe("po no");
    expect(normalizeHeader("S. No")).toBe("s no");
    expect(normalizeHeader("(-) Kg")).toBe("- kg");
    expect(normalizeHeader("- Wastage")).toBe("- wastage");
    expect(normalizeHeader("Wt - Kg")).toBe("wt kg"); // a dash between two words is still a separator
  });

  test("random spellings of each family share its key (5,000 draws)", () => {
    let s = 11;
    const r = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
    const wrap = [(x: string) => x, (x: string) => x.toUpperCase(), (x: string) => `  ${x}  `, (x: string) => `${x}:`, (x: string) => x.replace(/ /g, " ")];
    for (let i = 0; i < 5000; i++) {
      const f = pick(FAMILIES);
      const a = pick(wrap)(pick(f));
      expect(normalizeHeader(a), JSON.stringify(a)).toBe(normalizeHeader(f[0]!));
    }
  });

  test("built-in aliases: no two fields of a built-in share a key, and every alias still reads as itself", () => {
    for (const h of BUILTIN_HOLES) {
      const owner = new Map<string, string>();
      for (const f of h.fields) {
        for (const a of f.aliases) {
          const k = normalizeHeader(a);
          const o = owner.get(k);
          expect(o === undefined || o === f.field, `${h.id}: "${a}" (${k}) is ${o} and ${f.field}`).toBe(true);
          owner.set(k, f.field);
          expect(f.aliases.includes(readHeader(a).name), `${h.id}: ${a}`).toBe(true);
        }
      }
    }
  });
});
