import { describe, expect, test } from "bun:test";

import { normalizeHeader } from "./fingerprint";

// Round 7, rule 6.2 (M-R6-2, M-R6-3): every dash and minus folds to "-"; a "-" or "/" between two words is a
// separator; "+", "-" at the end or before a digit, and % # ± < > ≤ ≥ are signs and are kept; dots, colons, brackets,
// case and extra spaces do not matter; non-breaking and full-width characters fold; marks of Indian scripts are kept.

/** Each family is the spellings that must share one key. No two families may share a key. */
const FAMILIES: string[][] = [
  // M-R6-2: a dash or a slash between two words is a separator, spaced or not.
  ["Wt Kg", "Wt - Kg", "Wt-Kg", "Wt.-Kg", "WT – KG", "Wt—Kg", "Wt‐Kg", "Wt / Kg", "Wt/Kg", "Wt. (Kg)", "Wt (kg)", "wt  kg", "WT.KG."],
  ["Min Max", "Min - Max", "Min-Max", "Min – Max", "min‐max", "MIN‑MAX", "Min‒Max", "Min − Max", "Min/Max"],
  ["12 14", "12-14", "12 - 14", "12–14"],
  ["Kg 12ft", "Kg/12ft", "Kg / 12ft", "Kg-12ft", "KGS/12ft"],
  // Dots, colons, brackets, case, spaces.
  ["Sr No", "Sr. No.", "SR NO", "Sr-No", "Sr: No", "(Sr No)"],
  ["PO No", "P.O. No", "P.O. No.", "po no", "PO. NO:"],
  ["Party Name", "Party Name", "Ｐａｒｔｙ Ｎａｍｅ", "PARTY  NAME", "Party Name:", "[Party Name]"],
  ["Rate", "RATE:", "Rate.", "(Rate)"],
  // Signs.
  ["Tol +", "Tol+", "Tol (+)", "TOL +"],
  ["Tol -", "Tol –", "Tol (−)", "Tol‐", "TOL -", "Tol (-)", "Tol —"],
  ["Tol ±", "Tol±", "TOL (±)"],
  ["Tol +/-", "Tol + / -", "Tol (+/-)"],
  ["Tol", "TOL.", "tol:"],
  ["Rate %", "Rate%", "Rate (%)"],
  ["Order #", "Order#", "ORDER (#)"],
  ["Order", "Order."],
  [">12ft", "> 12ft", "＞12ft"],
  ["<12ft", "< 12ft"],
  ["≤12ft", "≤ 12ft"],
  ["≥12ft", "≥ 12ft"],
  ["-12", "−12", "–12"],
  ["12"],
  ["Kg (+)", "Kg+", "KG +"],
  ["Kg (-)", "Kg-", "Kg –", "KG (−)"],
  ["Kg", "Kgs", "Kg.", "KILOGRAM", "(Kg)", "kg:"],
  ["Pcs", "Pieces", "pc", "Pcs."],
  ["Nos", "No.", "NO"],
  ["Bundle No", "Bundle No.", "Bundle Nos"],
  ["#"],
  ["%"],
  ["-", "–", "(-)"],
  ["+", "(+)"],
  ["±"],
  // Indian scripts: marks are part of the letter; a trailing danda is punctuation.
  ["नाम", "नाम।", "नाम ।", "नाम:"],
  ["फ़र्म", "फ़र्म"],
  ["फर्म"],
  ["वज़न kg", "वज़न (Kg)", "वज़न - kg"],
  ["વજન", "વજન।"],
  ["પાર્ટી નું નામ", "પાર્ટી  નું  નામ"],
];

/** Near pairs that must differ (also covered by the families, named here for the report). */
const NEAR: [string, string][] = [
  ["Tol +", "Tol -"],
  ["Tol ±", "Tol +"],
  ["Tol ±", "Tol"],
  ["Tol –", "Tol"],
  ["Kg ‐", "Kg"],
  ["Rate %", "Rate"],
  ["Order #", "Order"],
  [">12ft", "<12ft"],
  ["≤12ft", "≥12ft"],
  ["Kg (+)", "Kg (-)"],
  ["Nos", "Pcs"],
  ["-12", "12"],
  ["फ़र्म", "फर्म"],
  ["#", ""],
  ["%", ""],
];

describe("6.2: names", () => {
  test("every family shares one key, and no two families share a key", () => {
    const keys = FAMILIES.map((f) => {
      const ks = [...new Set(f.map(normalizeHeader))];
      expect(ks, JSON.stringify(f)).toHaveLength(1);
      return ks[0]!;
    });
    const seen = new Map<string, number>();
    keys.forEach((k, i) => {
      expect(seen.has(k), `${JSON.stringify(FAMILIES[i])} shares "${k}" with ${JSON.stringify(FAMILIES[seen.get(k) ?? 0])}`).toBe(false);
      seen.set(k, i);
    });
  });

  test("the near pairs differ", () => {
    for (const [a, b] of NEAR) expect(normalizeHeader(a), `${a} | ${b}`).not.toBe(normalizeHeader(b));
  });

  test("random spellings of each family share its key (5,000 draws)", () => {
    let s = 7;
    const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
    // Changes rule 6.2 says do not matter: case, extra spaces, a trailing colon or dot, brackets round the name.
    const wrap = [(x: string) => x, (x: string) => x.toUpperCase(), (x: string) => `  ${x}  `, (x: string) => `${x}:`, (x: string) => `(${x})`, (x: string) => x.replace(/ /g, " ")];
    for (let i = 0; i < 5000; i++) {
      const f = pick(FAMILIES);
      const a = pick(wrap)(pick(f));
      expect(normalizeHeader(a), JSON.stringify(a)).toBe(normalizeHeader(f[0]!));
    }
  });
});
