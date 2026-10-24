import { describe, expect, test } from "bun:test";
import { en } from "./en";
import { hi } from "./hi";
import { GUIDE_SLUGS, type Guide } from "./guides/types";
import { guidesEn } from "./guides/en";
import { guidesHi } from "./guides/hi";

type Tree = { readonly [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/** `{name}` and `{count:one|other}` both name the variable `count`. */
function varsOf(s: string): string[] {
  return [...new Set([...s.matchAll(/\{(\w+)(?::[^}]*)?\}/g)].map((m) => m[1] as string))].sort();
}

function guideStrings(g: Guide): string[] {
  return [
    g.title,
    g.when,
    ...g.steps.flatMap((s) => [s.title, s.body]),
    ...g.problems.flatMap((p) => [p.title, p.fix]),
  ];
}

const enFlat = flatten(en as Tree);
const hiFlat = flatten(hi as Tree);

const allEnglish = [...enFlat.values(), ...GUIDE_SLUGS.flatMap((s) => guideStrings(guidesEn[s]))];
const allHindi = [...hiFlat.values(), ...GUIDE_SLUGS.flatMap((s) => guideStrings(guidesHi[s]))];

describe("message parity", () => {
  test("en and hi have the same keys", () => {
    const enKeys = [...enFlat.keys()].sort();
    const hiKeys = [...hiFlat.keys()].sort();
    expect(hiKeys.filter((k) => !enFlat.has(k))).toEqual([]);
    expect(enKeys.filter((k) => !hiFlat.has(k))).toEqual([]);
  });

  test("every {var} in an en string appears in the hi string, and no extra ones", () => {
    const mismatched: string[] = [];
    for (const [key, enValue] of enFlat) {
      const hiValue = hiFlat.get(key);
      if (hiValue === undefined) continue;
      if (varsOf(enValue).join(",") !== varsOf(hiValue).join(",")) mismatched.push(key);
    }
    expect(mismatched).toEqual([]);
  });

  test("no empty strings", () => {
    const empty = [...enFlat, ...hiFlat].filter(([, v]) => v.trim() === "").map(([k]) => k);
    expect(empty).toEqual([]);
  });

  test("has the base namespaces", () => {
    const required = [
      "common", "nav", "auth", "welcome", "today", "pack", "scan", "stock", "bundle", "dispatch",
      "packingList", "dies", "customers", "printing", "settings", "guides", "admin", "marketing",
      "errors", "status",
    ];
    expect(required.filter((ns) => !(ns in en))).toEqual([]);
  });

  test("status words follow the agreed labels", () => {
    expect(en.status.bundle).toEqual({
      available: "In stock",
      reserved: "Held",
      dispatched: "Dispatched",
      void: "Void",
    });
    expect(en.status.dispatch).toEqual({
      draft: "Building",
      reserved: "Held",
      completed: "Dispatched",
      cancelled: "Cancelled",
    });
  });
});

describe("guide parity", () => {
  test("both locales have every slug, keyed by its own slug", () => {
    for (const slug of GUIDE_SLUGS) {
      expect(guidesEn[slug].slug).toBe(slug);
      expect(guidesHi[slug].slug).toBe(slug);
    }
    expect(Object.keys(guidesEn).sort()).toEqual([...GUIDE_SLUGS].sort());
    expect(Object.keys(guidesHi).sort()).toEqual([...GUIDE_SLUGS].sort());
  });

  test("steps and problems have equal lengths per slug; roles match", () => {
    for (const slug of GUIDE_SLUGS) {
      expect({ slug, steps: guidesHi[slug].steps.length }).toEqual({ slug, steps: guidesEn[slug].steps.length });
      expect({ slug, problems: guidesHi[slug].problems.length }).toEqual({
        slug,
        problems: guidesEn[slug].problems.length,
      });
      expect(guidesHi[slug].roles).toEqual(guidesEn[slug].roles);
    }
  });

  test("each guide has 4 to 7 steps and at least one problem", () => {
    for (const slug of GUIDE_SLUGS) {
      const n = guidesEn[slug].steps.length;
      expect({ slug, ok: n >= 4 && n <= 7 }).toEqual({ slug, ok: true });
      expect({ slug, ok: guidesEn[slug].problems.length >= 1 }).toEqual({ slug, ok: true });
      expect({ slug, ok: guidesEn[slug].roles.length >= 1 }).toEqual({ slug, ok: true });
    }
  });

  test("no empty guide strings", () => {
    const empty = [...allEnglish, ...allHindi].filter((s) => s.trim() === "");
    expect(empty).toEqual([]);
  });
});

describe("copy rules", () => {
  const all = [...allEnglish, ...allHindi];

  test("no em dash, en dash, arrow or curly quotes", () => {
    expect(all.filter((s) => /[–—→‘’“”]/.test(s))).toEqual([]);
  });

  test('never "spool", "receipt" or "tenant"', () => {
    expect(all.filter((s) => /spool|receipt|tenant|mutation/i.test(s))).toEqual([]);
  });

  // GRN and MRS are the store's own paper forms (digest Stage 18); the floor knows them by those names.
  test("no ALL-CAPS words except known acronyms (English, and Latin text inside Hindi)", () => {
    // CM (BIS CM/L licence) and PVD (a finish) are what the plant writes on paper (FP Wave 1).
    const allowed = new Set(["PO", "PDF", "GSTIN", "GST", "CSV", "QR", "PL", "JSON", "PIN", "OK", "ID", "BG", "B001", "WB", "UB", "GRN", "MRS", "CM", "PVD"]);
    const offenders = all.flatMap((s) =>
      [...s.matchAll(/\b[A-Z][A-Z0-9]+\b/g)].map((m) => m[0]).filter((w) => !allowed.has(w)),
    );
    expect(offenders).toEqual([]);
  });

  test("at most one middle dot per string", () => {
    expect(all.filter((s) => (s.match(/·/g) ?? []).length > 1)).toEqual([]);
  });
});

describe("guides name real buttons", () => {
  const quoted = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);

  function unknownNames(book: typeof guidesEn, values: Set<string>): string[] {
    const titles = new Set(GUIDE_SLUGS.map((s) => book[s].title));
    return GUIDE_SLUGS.flatMap((slug) =>
      guideStrings(book[slug])
        .flatMap(quoted)
        .filter((name) => !values.has(name) && !titles.has(name))
        .map((name) => `${slug}: ${name}`),
    );
  }

  test("every quoted name in the English guides is an en.ts string or a guide title", () => {
    expect(unknownNames(guidesEn, new Set(enFlat.values()))).toEqual([]);
  });

  test("every quoted name in the Hindi guides is a hi.ts string or a guide title", () => {
    expect(unknownNames(guidesHi, new Set(hiFlat.values()))).toEqual([]);
  });

  test("each guide quotes UI names in both locales or in neither", () => {
    const mismatched = GUIDE_SLUGS.filter(
      (slug) => (guideStrings(guidesEn[slug]).flatMap(quoted).length > 0) !== (guideStrings(guidesHi[slug]).flatMap(quoted).length > 0),
    );
    expect(mismatched).toEqual([]);
  });
});
