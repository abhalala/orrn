import { describe, expect, test } from "bun:test";

import { createI18n } from "./index";
import { en } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";
import { keyOf, mapSentence, refusalEntries, SERVER_REFUSALS } from "./refusal";
import { AGEING_REFUSALS } from "./refusal-ageing";
import { ageingSentences, FILES } from "./refusal-sentences";

/**
 * W3-AG-S (review I3): every sentence of `lib/ageingRefusals.ts` is said from the dictionary once an
 * ageing screen has loaded `@orrn/i18n/refusal-ageing`, in en, hi and gu, and the ageing table never
 * rides in the shared one (the `/` entry modulepreloads the shared table).
 */
const lookup = (dict: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);

const sentences = ageingSentences();
const firstMatch = (s: string) => refusalEntries().find((e) => e.re.test(s));

describe("ageing refusals (AGEING_REFUSALS, ageing.refusal.*)", () => {
  test("the reader finds the ageing sentences; the shared table and its files hold none of them", () => {
    expect(sentences.length).toBeGreaterThan(55);
    expect(sentences.map((s) => s.text)).toContain("Say why this batch is voided");
    expect(SERVER_REFUSALS.some((e) => e.id.startsWith("ageing") || String(e.key ?? "").startsWith("ageing."))).toBe(false);
    expect(FILES).not.toContain("lib/ageingRefusals.ts");
    expect(refusalEntries().filter((e) => AGEING_REFUSALS.includes(e))).toEqual([...AGEING_REFUSALS]);
  });

  test("no ageing sentence is left without an entry, each is taken by an ageing entry first, and every entry is used", () => {
    expect(sentences.filter((s) => !firstMatch(s.text)).map((s) => `${s.file}: ${s.text}`)).toEqual([]);
    const taken = sentences.filter((s) => !AGEING_REFUSALS.includes(firstMatch(s.text)!)).map((s) => `${s.text} → ${firstMatch(s.text)!.id}`);
    expect(taken).toEqual([]);
    const used = new Set(sentences.map((s) => firstMatch(s.text)?.id));
    expect(AGEING_REFUSALS.filter((e) => !used.has(e.id)).map((e) => e.id)).toEqual([]);
  });

  test("each ageing key is a string in en, hi and gu", () => {
    for (const e of AGEING_REFUSALS) {
      for (const [lang, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ key: keyOf(e), lang, text: typeof lookup(dict, keyOf(e)) }).toEqual({ key: keyOf(e), lang, text: "string" });
      }
    }
  });

  test("an ageing sentence reads in Hindi and Gujarati, never as the server's English", () => {
    for (const lang of ["hi", "gu"] as const) {
      const t = createI18n(lang).t;
      for (const s of sentences) {
        const hit = mapSentence(s.text, t);
        expect({ from: s.text, mapped: hit !== null }).toEqual({ from: s.text, mapped: true });
        expect({ from: s.text, lang, same: t(hit!.key, hit!.vars) === s.text }).toEqual({ from: s.text, lang, same: false });
      }
    }
  });
});
