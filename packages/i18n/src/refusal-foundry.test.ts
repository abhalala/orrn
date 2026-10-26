import { describe, expect, test } from "bun:test";

import { createI18n } from "./index";
import { en } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";
import { keyOf, mapSentence, refusalEntries, SERVER_REFUSALS } from "./refusal";
import { FOUNDRY_REFUSALS } from "./refusal-foundry";
import { foundrySentences } from "./refusal-sentences";

/**
 * W2-FD-S: every sentence the foundry routers raise (message:, bad(), MELT_GATE_TEXT) is said from the
 * dictionary once a foundry screen has loaded `@orrn/i18n/refusal-foundry`, in en, hi and gu, and the
 * foundry table never rides in the shared one (the `/` entry stays within its budget).
 */
const lookup = (dict: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);

const sentences = foundrySentences();
const firstMatch = (s: string) => refusalEntries().find((e) => e.re.test(s));

describe("foundry refusals (FOUNDRY_REFUSALS, foundry.refusal.*)", () => {
  test("the reader finds the foundry sentences; the shared table holds none of the foundry entries", () => {
    expect(sentences.length).toBeGreaterThan(80);
    expect(sentences.map((s) => s.text)).toContain("Spectro has not passed; say why the melt is locked anyway");
    expect(SERVER_REFUSALS.some((e) => e.id.startsWith("fd_"))).toBe(false);
    expect(refusalEntries().slice(SERVER_REFUSALS.length)).toEqual([...FOUNDRY_REFUSALS]);
  });

  test("no foundry sentence is left without an entry, and every foundry entry is the first match of one", () => {
    expect(sentences.filter((s) => !firstMatch(s.text)).map((s) => `${s.file}: ${s.text}`)).toEqual([]);
    const used = new Set(sentences.map((s) => firstMatch(s.text)?.id));
    expect(FOUNDRY_REFUSALS.filter((e) => !used.has(e.id)).map((e) => e.id)).toEqual([]);
  });

  test("each foundry key is a string in en, hi and gu", () => {
    for (const e of FOUNDRY_REFUSALS) {
      for (const [lang, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ key: keyOf(e), lang, text: typeof lookup(dict, keyOf(e)) }).toEqual({ key: keyOf(e), lang, text: "string" });
      }
    }
  });

  test("a foundry sentence reads in Hindi and Gujarati without the server's English", () => {
    const english = /\b(?:is|are|was|the|cannot|can't|must|first|nothing|pick|only)\b/i;
    for (const lang of ["hi", "gu"] as const) {
      const t = createI18n(lang).t;
      for (const s of sentences) {
        const hit = mapSentence(s.text, t);
        expect({ from: s.text, mapped: hit !== null }).toEqual({ from: s.text, mapped: true });
        const said = t(hit!.key, hit!.vars);
        expect({ from: s.text, lang, english: english.test(said) }).toEqual({ from: s.text, lang, english: false });
      }
    }
  });

  test("reserved legacy codes explain the series boundary in English and Hindi", () => {
    const sentence = "A legacy code cannot be a cast series code or bundle number";
    for (const lang of ["en", "hi"] as const) {
      const t = createI18n(lang).t;
      const hit = mapSentence(sentence, t);
      expect(hit).not.toBeNull();
      const said = t(hit!.key, hit!.vars);
      if (lang === "hi") {
        expect(said).toMatch(/[\u0900-\u097f]/);
        expect(said).not.toBe(sentence);
      } else {
        expect(said).toContain("series");
      }
    }
  });

  test("a worked sentence: the tail refusal names the kg and the cast", () => {
    const t = createI18n("en").t;
    const hit = mapSentence("41.6 kg of J3 billets is not explained; pick a reason", t)!;
    expect(t(hit.key, hit.vars)).toBe("41.6 kg of J3 billets is not explained. Pick a reason.");
  });
});
