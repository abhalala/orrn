import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { gu } from "./gu";
import { getGuide, listGuides } from "./guides";
import { guidesEn } from "./guides/en";
import { guidesGu } from "./guides/gu";
import { GUIDE_SLUGS, GUIDE_SLUGS_FP, GUIDE_SLUGS_GU, type Guide } from "./guides/types";

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

function guideStrings(g: Guide): string[] {
  return [g.title, g.when, ...g.steps.flatMap((s) => [s.title, s.body]), ...g.problems.flatMap((p) => [p.title, p.fix])];
}

const quoted = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);

const enFlat = flatten(en as Tree);
const guFlat = flatten(gu as unknown as Tree);
/** What a Gujarati reader's screen shows: the gu word, else the English one (`gu` loads English with it). */
const shown = new Set([...enFlat.keys()].map((k) => guFlat.get(k) ?? (enFlat.get(k) as string)));

describe("Gujarati guides (floor flows)", () => {
  test("the book holds exactly the floor slugs, each with its own slug", () => {
    expect(Object.keys(guidesGu).sort()).toEqual([...GUIDE_SLUGS_GU].sort());
    for (const slug of GUIDE_SLUGS_GU) expect(guidesGu[slug].slug).toBe(slug);
  });

  test("the floor flows are covered: pack, scan, dispatch, press station, die issue and return", () => {
    for (const slug of ["pack-session", "scan-bundle", "build-dispatch", "dispatch-from-order", "press-station-day", "die-issue-return"] as const) {
      expect(GUIDE_SLUGS_GU as readonly string[]).toContain(slug);
    }
  });

  test("same steps, problems and roles as the English guide, one for one", () => {
    for (const slug of GUIDE_SLUGS_GU) {
      expect({ slug, steps: guidesGu[slug].steps.length }).toEqual({ slug, steps: guidesEn[slug].steps.length });
      expect({ slug, problems: guidesGu[slug].problems.length }).toEqual({ slug, problems: guidesEn[slug].problems.length });
      expect(guidesGu[slug].roles).toEqual(guidesEn[slug].roles);
    }
  });

  test("the text is Gujarati, not a copy of the English", () => {
    for (const slug of GUIDE_SLUGS_GU) {
      const g = guidesGu[slug];
      expect({ slug, gujarati: /[઀-૿]/.test(g.title) && /[઀-૿]/.test(g.when) }).toEqual({ slug, gujarati: true });
      for (const [i, s] of g.steps.entries()) {
        expect({ slug, step: i, gujarati: /[઀-૿]/.test(s.title) && /[઀-૿]/.test(s.body) }).toEqual({ slug, step: i, gujarati: true });
        expect({ slug, step: i, same: s.body === guidesEn[slug].steps[i]!.body }).toEqual({ slug, step: i, same: false });
      }
    }
  });

  test("no empty strings; 4 to 7 steps; at least one problem", () => {
    for (const slug of GUIDE_SLUGS_GU) {
      const g = guidesGu[slug];
      expect(guideStrings(g).filter((s) => s.trim() === "")).toEqual([]);
      expect(g.steps.length).toBeGreaterThanOrEqual(4);
      expect(g.steps.length).toBeLessThanOrEqual(7);
      expect(g.problems.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("copy rules: no dashes, arrows or curly quotes; none of the banned words; no stray capitals", () => {
    const all = GUIDE_SLUGS_GU.flatMap((s) => guideStrings(guidesGu[s]));
    expect(all.filter((s) => /[–—→‘’“”]/.test(s))).toEqual([]);
    expect(all.filter((s) => /spool|receipt|tenant|mutation/i.test(s))).toEqual([]);
    // BG-000001-B001 is a serial shown as an example; Ctrl, Cmd, Mac and Enter are keys, not acronyms.
    const allowed = new Set(["A4", "PO", "PDF", "QR", "PL", "OK", "BG", "B001", "MB", "CDR", "DWG"]);
    const offenders = all.flatMap((s) => [...s.matchAll(/\b[A-Z][A-Z0-9]+\b/g)].map((m) => m[0]).filter((w) => !allowed.has(w)));
    expect(offenders).toEqual([]);
  });

  test("every quoted name is a word the Gujarati screen shows (or a guide title)", () => {
    const titles = new Set(GUIDE_SLUGS.map((s) => getGuide(s, "gu").title));
    const unknown = GUIDE_SLUGS_GU.flatMap((slug) =>
      guideStrings(guidesGu[slug])
        .flatMap(quoted)
        .filter((name) => !shown.has(name) && !titles.has(name))
        .map((name) => `${slug}: ${name}`),
    );
    expect(unknown).toEqual([]);
  });

  test("getGuide returns the Gujarati text for a floor guide and the English text for the rest", () => {
    for (const slug of GUIDE_SLUGS_GU) expect(getGuide(slug, "gu").title).toBe(guidesGu[slug].title);
    for (const slug of GUIDE_SLUGS_FP.filter((s) => !(GUIDE_SLUGS_GU as readonly string[]).includes(s))) {
      expect(getGuide(slug, "gu").title).toBe(guidesEn[slug].title);
    }
    expect(listGuides("gu")).toHaveLength(GUIDE_SLUGS.length);
  });
});
