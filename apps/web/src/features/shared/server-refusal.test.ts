import { describe, expect, test } from "bun:test";
import { createI18n } from "@orrn/i18n";
import { blockersOf, keyOf, SERVER_REFUSALS, type RefusalEntry } from "@orrn/i18n/refusal";
import { serverSentences } from "@orrn/i18n/refusal-sentences";
import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";

import { orderErrorLines } from "../orders/errors";
import { refusalText } from "../die-room/die-room-model";
import { mapSentence, serverRefusal, serverRefusalLines } from "./server-refusal";

/**
 * BACKLOG 48: the die room and orders screens never show the server's English. The web reads the same
 * server files as the phone's test (`@orrn/i18n/refusal-sentences`); a new sentence there fails here until
 * it has an entry in `packages/i18n/src/refusal.ts` and a key in en, hi and gu.
 */
const lookup = (dict: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);

const sentences = serverSentences();
const matches = (s: string): RefusalEntry | undefined => SERVER_REFUSALS.find((e) => e.re.test(s));
const err = (code: string, message: string, meta?: Record<string, unknown>) => ({ message, data: { code, ...(meta ? { meta } : {}) } });

describe("every die room, orders and approval sentence has wording in all three languages", () => {
  test("the reader finds the server's sentences", () => {
    expect(sentences.length).toBeGreaterThan(150);
    expect(sentences.map((s) => s.text)).toContain("This request was already decided");
  });

  test("no sentence is left without an entry", () => {
    const unmapped = sentences.filter((s) => !blockersOf(s.text) && !matches(s.text));
    expect(unmapped.map((s) => `${s.file}: ${s.text}`)).toEqual([]);
  });

  test("each entry's key is a string in en, hi and gu (the web renders gu with no fallback to English)", () => {
    for (const e of SERVER_REFUSALS) {
      for (const [lang, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ key: keyOf(e), lang, text: typeof lookup(dict, keyOf(e)) }).toEqual({ key: keyOf(e), lang, text: "string" });
      }
    }
    for (const k of ["refusal.unknown", "refusal.owned", "refusal.stillNeeds", "errors.forbidden", "errors.conflict", "errors.notFound", "errors.network", "errors.sessionExpired", "errors.generic"]) {
      for (const dict of [en, hi, gu]) expect({ k, text: typeof lookup(dict, k) }).toEqual({ k, text: "string" });
    }
  });

  test("a mapped sentence reads in Gujarati without the server's English", () => {
    const t = createI18n("gu").t;
    const english = /\b(?:is|are|was|the|cannot|can't|must|first|nothing|pick|only)\b/i;
    for (const s of sentences) {
      if (blockersOf(s.text)) continue;
      const said = serverRefusal(t, err("BAD_REQUEST", s.text));
      expect({ from: s.text, said }).not.toEqual({ from: s.text, said: s.text });
      expect({ from: s.text, english: english.test(said) }).toEqual({ from: s.text, english: false });
    }
  });
});

describe("what the die room and orders screens say", () => {
  test("a known refusal, an owned die, a confirm with blockers, an unknown sentence", () => {
    for (const lang of ["en", "hi", "gu"] as const) {
      const t = createI18n(lang).t;
      expect(refusalText(err("CONFLICT", "12170-2 is already issued to P1"), t)).toBe(t("refusal.alreadyIssued", { code: "12170-2", line: "P1" }));
      expect(refusalText(err("FORBIDDEN", "This die belongs to KD", { ownerName: "KD Extrusion" }), t)).toBe(t("refusal.owned", { name: "KD Extrusion" }));
      expect(orderErrorLines(t, err("BAD_REQUEST", "Fill these before confirming: po_number, line_1_pcs"))).toEqual([
        t("orders.blockers.po_number"),
        t("orders.blockers.line", { n: 1, problem: t("orders.blockers.pcs") }),
      ]);
      expect(serverRefusalLines(t, err("BAD_REQUEST", "Never seen before"))).toEqual([t("refusal.unknown")]);
      expect(serverRefusal(t, err("BAD_REQUEST", "[{\"code\":\"too_small\"}]"))).toBe(t("refusal.unknown"));
      expect(serverRefusal(t, err("UNAUTHORIZED", "x"))).toBe(t("errors.sessionExpired"));
    }
  });

  test("a status word the build does not know falls to the generic line, not to English", () => {
    const t = createI18n("gu").t;
    expect(serverRefusal(t, err("BAD_REQUEST", "A paused order can't be closed"))).toBe(t("refusal.unknown"));
    expect(mapSentence("Something else entirely", t)).toBeNull();
  });

  test("an approval that was decided already, or is your own, is worded", () => {
    for (const lang of ["en", "hi", "gu"] as const) {
      const t = createI18n(lang).t;
      expect(serverRefusal(t, err("BAD_REQUEST", "This request was already decided"))).toBe(t("refusal.alreadyDecided"));
      expect(serverRefusal(t, err("FORBIDDEN", "Someone else has to approve your request"))).toBe(t("refusal.ownRequest"));
    }
  });
});
