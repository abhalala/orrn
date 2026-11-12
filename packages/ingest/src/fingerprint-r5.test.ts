import { describe, expect, test } from "bun:test";

import { normalizeHeader, normalizeHeaders } from "./fingerprint";
import { chooseHeader } from "./header";
import { layoutOf } from "./readers/trust-helpers";

// PORTAL-RULES-3 section 5.1 (B2): normalising keeps letters of every script, and Latin behaves as before.

/** The round 4 normaliser, kept here to prove Latin text normalises exactly as it did. */
function before(h: string): string {
  const UNIT_TOKENS: [RegExp, string][] = [
    [/(?<![a-z0-9])(?:kgs|kg\.|kilos?)(?![a-z0-9])/g, "kg"],
    [/(?<![a-z0-9])(?:mtrs?|meters?|metres?)(?![a-z0-9])/g, "m"],
    [/(?<![a-z0-9])(?:feet|foot)(?![a-z0-9])/g, "ft"],
    [/(?<![a-z0-9])(?:nos|pcs\.)(?![a-z0-9])/g, "pcs"],
    [/(?<![a-z0-9])(?:rs\.|rs|inr)(?![a-z0-9])|₹/g, "inr"],
  ];
  let t = h.normalize("NFKC").toLowerCase();
  t = t.replace(/'/g, " ft ");
  for (const [re, to] of UNIT_TOKENS) t = t.replace(re, (m) => (m === "₹" ? " inr " : to));
  return t.replace(/[^a-z0-9/]+/g, " ").trim();
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i));
const LATIN = [...range(0x61, 0x7a), ...range(0x41, 0x5a)];
// Consonants, then vowel signs and the virama, as names are written.
const DEVA = { base: range(0x915, 0x939), marks: [...range(0x93e, 0x94c), "्"] };
const GUJ = { base: range(0xa95, 0xab9).filter((c) => /\p{L}/u.test(c)), marks: [...range(0xabe, 0xacc).filter((c) => /\p{M}/u.test(c)), "્"] };
const UNIT_WORD = /^(kgs?|kilos?|mtrs?|meters?|metres?|feet|foot|nos|pcs|rs|inr|m|ft)$/i;

function word(r: () => number, script: number): string {
  const n = 2 + Math.floor(r() * 5);
  let out = "";
  for (let i = 0; i < n; i++) {
    if (script === 0) out += LATIN[Math.floor(r() * LATIN.length)];
    else {
      const s = script === 1 ? DEVA : GUJ;
      out += s.base[Math.floor(r() * s.base.length)];
      if (r() < 0.5) out += s.marks[Math.floor(r() * s.marks.length)];
    }
  }
  return UNIT_WORD.test(out) ? out + "x" : out;
}
/** A name of one or two words in one script, with random case, spaces and punctuation around it. */
function name(r: () => number): string {
  const script = Math.floor(r() * 3);
  const words = Array.from({ length: 1 + Math.floor(r() * 2) }, () => word(r, script));
  const punct = ["", ".", ":", " (", ")", " -", "  "];
  return punct[Math.floor(r() * punct.length)] + words.join(punct[Math.floor(r() * punct.length)] || " ") + punct[Math.floor(r() * punct.length)];
}
/** What a name is once case, spaces and punctuation are set aside. */
const bare = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "");

describe("5.1: the normaliser", () => {
  // Round 6 (owner's decision): the signs + - % # are kept and the count words "Nos" and "Pcs" no longer fold
  // together. This test pinned that all Latin text normalises as in round 4; it now pins that Latin text with none
  // of those signs or count words normalises as before, and that the changed names are exactly the ones the owner
  // named.
  // Round 7, rule 6.2 also keeps < and >, makes "/" a separator, and joins single letters split by dots ("P.O.").
  const changed = (s: string) =>
    /[+%#<>/-]/.test(s) ||
    /(?<![a-z0-9])(?:pc|pieces?|nos|kilograms?)(?![a-z0-9])/.test(s.normalize("NFKC").toLowerCase()) ||
    /(?<![a-z0-9])[a-z]\.[a-z](?![a-z0-9])/i.test(s);
  test("Latin text with no sign and no count word normalises exactly as before (5,000 random ASCII names and every unit form)", () => {
    const r = rng(7);
    const ascii = range(0x20, 0x7e);
    let kept = 0;
    for (let i = 0; i < 5000; i++) {
      const s = Array.from({ length: 1 + Math.floor(r() * 20) }, () => ascii[Math.floor(r() * ascii.length)]).join("");
      if (changed(s)) continue;
      kept++;
      expect(normalizeHeader(s)).toBe(before(s));
    }
    expect(kept).toBeGreaterThan(1500);
    for (const s of ["Wt (Kgs)", "Kg.", "Rs.", "₹ Rate", "Length 12'", "Pcs.", "Bundle No.", "S.No", "Party Name:", "Sr-No", "Sr. No."]) {
      expect(normalizeHeader(s)).toBe(before(s));
    }
    // The names round 6 changes, and how.
    const names = ["NOS", "Pieces", "Tol +", "Rate %", "Order #", "Kg (-)", "Min weight (kg/12ft)", "P.O. No", ">12ft"];
    expect(names.map(normalizeHeader)).toEqual(["no", "pcs", "tol +", "rate %", "order #", "kg -", "min weight kg 12ft", "po no", "> 12ft"]);
    expect(names.map(before)).toEqual(["pcs", "pieces", "tol", "rate", "order", "kg", "min weight kg/12ft", "p o no", "12ft"]);
  });

  // Round 7 (item 5): the joiners U+200C and U+200D are kept, as in cell text; other format characters are dropped.
  // This test pinned the joiner dropped; it now pins it kept, and a zero-width space dropped.
  test("Hindi and Gujarati names stay names; joiners are kept, other format characters dropped", () => {
    expect(normalizeHeader("પાર્ટી નું નામ")).toBe("પાર્ટી નું નામ");
    expect(normalizeHeader("वज़न (kg)")).toBe("वज़न kg");
    expect(normalizeHeader("क्\u200dष")).toBe("क्\u200dष");
    expect(normalizeHeader("क्\u200bष")).toBe("क्ष");
    expect(normalizeHeaders(["नाम", "", "શહેર"])).toEqual(["नाम", "_1", "શહેર"]);
  });

  test("two names give one key only when they differ by case, spaces or punctuation (20,000 pairs, three scripts)", () => {
    const r = rng(11);
    for (let i = 0; i < 20000; i++) {
      const a = name(r);
      const b = r() < 0.2 ? a.toUpperCase().replace(/ /g, "  ") + "." : name(r);
      const same = normalizeHeader(a).replace(/ /g, "") === normalizeHeader(b).replace(/ /g, "");
      expect(same).toBe(bare(a) === bare(b));
      expect(normalizeHeader(a)).not.toBe("");
    }
  });

  test("a different header row never fits a learned layout exactly (3,000 rows, three scripts)", () => {
    const r = rng(13);
    let asked = 0;
    for (let i = 0; i < 3000; i++) {
      const width = 2 + Math.floor(r() * 4);
      const a = Array.from({ length: width }, () => name(r));
      const b = a.map((c) => (r() < 0.6 ? c : name(r)));
      if (b.every((c, k) => bare(c) === bare(a[k]!))) b[Math.floor(r() * width)] = name(r) + word(r, Math.floor(r() * 3));
      const data = [Array.from({ length: width }, (_, k) => `v${k}`), Array.from({ length: width }, (_, k) => `w${k}`)];
      const preview = [b, ...data].map((cells, row) => ({ row, cells }));
      const c = chooseHeader({ preview, guess: { headerRow: 0 } }, { learned: [layoutOf(a, "a")], builtins: [] });
      expect(c.kind).toBe("ask");
      asked++;
      // The same row does fit.
      const same = [a, ...data].map((cells, row) => ({ row, cells }));
      expect(chooseHeader({ preview: same, guess: { headerRow: 0 } }, { learned: [layoutOf(a, "a")], builtins: [] }).kind).toBe("fits");
    }
    expect(asked).toBe(3000);
  });
});
