import { describe, expect, test } from "bun:test";

import { createI18n } from "./index";
import { en } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";
import { keyOf, mapSentence, refusalEntries, SERVER_REFUSALS } from "./refusal";
import "./refusal-foundry";
import "./refusal-ageing";
import { QA_REFUSALS } from "./refusal-qa";
import { FILES, qaSentences } from "./refusal-sentences";

/**
 * XE parity lane QA: every sentence of `lib/qaRefusals.ts` is said from the dictionary once a screen has
 * loaded `@orrn/i18n/refusal-qa`, in en, hi and gu, and the quality table never rides in the shared one.
 */
const lookup = (dict: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);

const sentences = qaSentences();
const firstMatch = (s: string) => refusalEntries().find((e) => e.re.test(s));
/** Sentences another table says first, with the same words: the shared "Not found", the die room copy rule and the ageing code rules. */
const SHARED = new Set(["Not found", "This die copy belongs to another section", "The code 7 is already used", "Use letters, digits and dashes for the code, at most 16"]);

describe("quality refusals (QA_REFUSALS, qa.refusal.*)", () => {
  test("the reader finds the quality sentences; the shared table and its files hold none of them", () => {
    expect(sentences.length).toBeGreaterThan(25);
    expect(sentences.map((s) => s.text)).toContain("Bundle 7 is on quality hold");
    expect(SERVER_REFUSALS.some((e) => e.id.startsWith("qa") || String(e.key ?? "").startsWith("qa."))).toBe(false);
    expect(FILES).not.toContain("lib/qaRefusals.ts");
  });

  test("no quality sentence is left without an entry; each one is taken by a quality entry unless another table has the same words", () => {
    expect(sentences.filter((s) => !firstMatch(s.text)).map((s) => s.text)).toEqual([]);
    const taken = sentences.filter((s) => !SHARED.has(s.text) && !QA_REFUSALS.includes(firstMatch(s.text)!)).map((s) => `${s.text} -> ${firstMatch(s.text)!.id}`);
    expect(taken).toEqual([]);
  });

  test("each quality key is a string in en, hi and gu", () => {
    for (const e of QA_REFUSALS) {
      for (const [lang, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ key: keyOf(e), lang, text: typeof lookup(dict, keyOf(e)) }).toEqual({ key: keyOf(e), lang, text: "string" });
      }
    }
  });

  test("a quality sentence reads in Hindi and Gujarati, never as the server's English", () => {
    for (const lang of ["hi", "gu"] as const) {
      const t = createI18n(lang).t;
      for (const s of sentences) {
        const hit = mapSentence(s.text, t);
        expect({ from: s.text, mapped: hit !== null }).toEqual({ from: s.text, mapped: true });
        expect({ from: s.text, lang, same: t(hit!.key, hit!.vars) === s.text }).toEqual({ from: s.text, lang, same: false });
      }
    }
  });

  test("the scan refusal names the bundle", () => {
    const t = createI18n("en").t;
    const hit = mapSentence("Bundle 26J12 is on quality hold", t)!;
    expect(t(hit.key, hit.vars)).toBe("Bundle 26J12 is on quality hold");
  });
});
