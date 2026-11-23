import { describe, expect, test } from "bun:test";

import { createI18n } from "./index";
import { en } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";
import { keyOf, mapSentence, refusalEntries, SERVER_REFUSALS } from "./refusal";
// Every module table registered (foundry and ageing before this one), so the first-match checks below cover every registered table.
import "./refusal-foundry";
import "./refusal-ageing";
import { JOBWORK_REFUSALS } from "./refusal-jobwork";
import { jobworkSentences, FILES } from "./refusal-sentences";

/**
 * XE parity lane JOBWORK: every sentence of `lib/processRefusals.ts` is said from the dictionary once a
 * screen has loaded `@orrn/i18n/refusal-jobwork`, in en, hi and gu, and the table never rides in the
 * shared one (the `/` entry modulepreloads the shared table).
 */
const lookup = (dict: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);

const sentences = jobworkSentences();
const firstMatch = (s: string) => refusalEntries().find((e) => e.re.test(s));

describe("job-work refusals (JOBWORK_REFUSALS, jw.refusal.*)", () => {
  test("the reader finds the job-work sentences; the shared table and its files hold none of them", () => {
    expect(sentences.length).toBeGreaterThan(20);
    expect(sentences.map((s) => s.text)).toContain("Pick the job-work vendor");
    expect(SERVER_REFUSALS.some((e) => e.id.startsWith("jw") || String(e.key ?? "").startsWith("jw."))).toBe(false);
    expect(FILES).not.toContain("lib/processRefusals.ts");
    expect(refusalEntries().filter((e) => JOBWORK_REFUSALS.includes(e))).toEqual([...JOBWORK_REFUSALS]);
  });

  test("no job-work sentence is left without an entry, each is taken by an job-work entry first, and every entry is used", () => {
    expect(sentences.filter((s) => !firstMatch(s.text)).map((s) => `${s.file}: ${s.text}`)).toEqual([]);
    const taken = sentences.filter((s) => !JOBWORK_REFUSALS.includes(firstMatch(s.text)!)).map((s) => `${s.text} → ${firstMatch(s.text)!.id}`);
    expect(taken).toEqual([]);
    const used = new Set(sentences.map((s) => firstMatch(s.text)?.id));
    expect(JOBWORK_REFUSALS.filter((e) => !used.has(e.id)).map((e) => e.id)).toEqual([]);
  });

  test("each job-work key is a string in en, hi and gu", () => {
    for (const e of JOBWORK_REFUSALS) {
      for (const [lang, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ key: keyOf(e), lang, text: typeof lookup(dict, keyOf(e)) }).toEqual({ key: keyOf(e), lang, text: "string" });
      }
    }
  });

  test("an job-work sentence reads in Hindi and Gujarati, never as the server's English", () => {
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
