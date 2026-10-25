import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";
import { serverSentences } from "@orrn/i18n/refusal-sentences";
import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";

import { blockerText } from "../features/orders/order-model";
import { RequestTimeoutError } from "../lib/request-timeout";
import { blockersOf, keyOf, mapSentence, SERVER_REFUSALS, serverRefusal, serverRefusalLines, type RefusalEntry } from "../lib/server-refusal";

function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), dict);
}

/** Sentences the phone is deliberately not given a key for, each with its reason. Nothing here may be reachable from a native screen. */
const ALLOWED_UNMAPPED: { text: RegExp; why: string }[] = [
  // (none today: every server sentence in these files has a key)
];

const matches = (s: string): RefusalEntry | undefined => SERVER_REFUSALS.find((e) => e.re.test(s));
const isBlockers = (s: string) => blockersOf(s) !== null;

// ---------------------------------------------------------------------------

describe("every die room and orders refusal has a sentence in the person's language (BACKLOG 29, 43)", () => {
  const sentences = serverSentences();

  test("the source reader finds the sentences (guards the reader itself)", () => {
    expect(sentences.length).toBeGreaterThan(150);
    const texts = sentences.map((s) => s.text);
    expect(texts).toContain("Pick the die copy");
    expect(texts).toContain("7 is already issued to a press");
    expect(texts).toContain("7 is held on dispatch 7");
    expect(texts).toContain("PO 7 is already on 7 for this customer");
    expect(texts).toContain("7 line 7: 7 kg asked, only 7 kg is left to plan");
    expect(texts).toContain("Fill these before confirming: 7");
  });

  test("no sentence is left without a key", () => {
    const unmapped = sentences.filter((s) => !isBlockers(s.text) && !matches(s.text) && !ALLOWED_UNMAPPED.some((a) => a.text.test(s.text)));
    expect(unmapped.map((s) => `${s.file}: ${s.text}`)).toEqual([]);
  });

  test("every allow-list row still matters and states a reason", () => {
    for (const a of ALLOWED_UNMAPPED) {
      expect(a.why.length).toBeGreaterThan(10);
      expect(sentences.some((s) => a.text.test(s.text))).toBe(true);
    }
  });

  test("no entry is dead: each one is the first match of at least one server sentence", () => {
    const hit = new Set<RefusalEntry>();
    for (const s of sentences) {
      const e = matches(s.text);
      if (e) hit.add(e);
    }
    expect(SERVER_REFUSALS.filter((e) => !hit.has(e)).map((e) => `${e.id}: ${e.re}`)).toEqual([]);
  });

  test("each entry's key exists in English, Hindi and Gujarati", () => {
    for (const e of SERVER_REFUSALS) {
      const k = keyOf(e);
      for (const [name, dict] of [["en", en], ["hi", hi], ["gu", gu]] as const) {
        expect({ key: k, lang: name, text: typeof lookup(dict, k) }).toEqual({ key: k, lang: name, text: "string" });
      }
    }
  });

  test("every refusal key is used by an entry (or the generic line), and no entry is shadowed by an earlier one", () => {
    const used = new Set<string>(SERVER_REFUSALS.map(keyOf));
    used.add("refusal.unknown");
    used.add("refusal.joinAnd");
    used.add("refusal.stillNeeds");
    used.add("refusal.owned");
    used.add("refusal.ownedOther");
    const all = Object.keys((en as unknown as { refusal: Record<string, string> }).refusal).map((k) => `refusal.${k}`);
    expect(all.filter((k) => !used.has(k))).toEqual([]);
  });

  test("a mapped sentence uses the variables its text names, in all three languages", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)(?::[^}]*)?\}/g)].map((m) => m[1]!).sort();
    const bundledVars: Record<string, string[]> = {};
    for (const s of sentences) {
      const e = matches(s.text);
      if (!e || !e.vars) continue;
      const m = e.re.exec(s.text)!;
      // The status words are the app's own; give the entry a real one where the server names a state.
      const t = createI18n("en").t;
      const v = e.vars(m, t);
      if (v === null) continue; // a status word the placeholder is not (checked below)
      bundledVars[keyOf(e)] = Object.keys(v).sort();
    }
    for (const [key, names] of Object.entries(bundledVars)) {
      for (const dict of [en, hi, gu]) {
        const text = lookup(dict, key);
        if (typeof text !== "string") continue;
        expect({ key, vars: placeholders(text) }).toEqual({ key, vars: names.filter((n) => placeholders(text).includes(n)).sort() });
        for (const n of placeholders(text)) expect({ key, n, given: names.includes(n) }).toEqual({ key, n, given: true });
      }
    }
  });
});

describe("what a person is told", () => {
  const trpc = (code: string, message: string, meta?: Record<string, unknown>) => ({ message, data: { code, httpStatus: code === "INTERNAL_SERVER_ERROR" ? 500 : 400, ...(meta ? { meta } : {}) } });
  const LANGS = { en: createI18n("en").t, hi: createI18n("hi").t, gu: createI18n("gu").t } as const;

  test("a known refusal is said from the dictionary with its names", () => {
    expect(serverRefusal(trpc("CONFLICT", "12170-2 is already issued to P1"), LANGS.en)).toBe("12170-2 is already issued to P1.");
    expect(serverRefusal(trpc("BAD_REQUEST", "12170-2 is out at nitriding"), LANGS.en)).toBe("12170-2 can't be used for this now. Status: At nitriding.");
    expect(serverRefusal(trpc("BAD_REQUEST", "12170-2 is issued to a press; it cannot be sent to nitriding"), LANGS.hi)).toContain("12170-2");
    expect(serverRefusal(trpc("BAD_REQUEST", "12170-2 is out at nitriding"), LANGS.hi)).not.toMatch(/[A-Za-z]{4,} (?:can't|is|has)/);
    expect(serverRefusal(trpc("CONFLICT", "12170-2 or PR-4 changed meanwhile; nothing was issued"), LANGS.gu)).not.toContain("meanwhile");
  });

  test("the words the server names are the app's own, per language", () => {
    const m = "Only a booking can be confirmed (this order is closed)";
    expect(serverRefusal(trpc("BAD_REQUEST", m), LANGS.en)).toBe("Only a booking can be confirmed. This order is Closed.");
    expect(serverRefusal(trpc("BAD_REQUEST", m), LANGS.hi)).toContain(LANGS.hi("orders.status.closed"));
    expect(serverRefusal(trpc("BAD_REQUEST", m), LANGS.gu)).toContain(LANGS.gu("orders.status.closed"));
    expect(serverRefusal(trpc("BAD_REQUEST", "Only a draft plan can be released (this plan is released)"), LANGS.en)).toContain("Released");
    expect(serverRefusal(trpc("BAD_REQUEST", "An edit can't move the order from confirmed to booking. Use Confirm, Close or Cancel."), LANGS.en)).toBe(
      "An edit can't move the order from Confirmed to Booking. Use Confirm, Close or Cancel.",
    );
  });

  test("an owned die names its owner, from the server's meta first", () => {
    expect(serverRefusal(trpc("FORBIDDEN", "This die belongs to KD Extrusion", { ownerName: "KD Extrusion" }), LANGS.en)).toBe("This die belongs to KD Extrusion.");
    expect(serverRefusal(trpc("FORBIDDEN", "This die belongs to KD Extrusion"), LANGS.hi)).toBe(LANGS.hi("refusal.owned", { name: "KD Extrusion" }));
    expect(serverRefusal(trpc("FORBIDDEN", "This die belongs to another customer"), LANGS.en)).toBe("This die belongs to another customer.");
    expect(serverRefusal(trpc("FORBIDDEN", "Missing permission die.issue"), LANGS.en)).toBe(LANGS.en("errors.forbidden"));
  });

  test("a sentence this build does not know is never shown or spoken", () => {
    for (const lang of ["en", "hi", "gu"] as const) {
      const t = LANGS[lang];
      const said = serverRefusal(trpc("BAD_REQUEST", "Some new English sentence the server learnt"), t);
      expect(said).toBe(t("refusal.unknown"));
      expect(said).not.toContain("Some new");
    }
    expect(serverRefusal(trpc("CONFLICT", "Brand new conflict"), LANGS.en)).toBe(LANGS.en("errors.conflict"));
    expect(serverRefusal(trpc("NOT_FOUND", "Brand new miss"), LANGS.en)).toBe(LANGS.en("errors.notFound"));
    expect(serverRefusal(trpc("BAD_REQUEST", '[{"code":"too_small","message":"Required"}]'), LANGS.en)).toBe(LANGS.en("refusal.unknown"));
    expect(serverRefusal(trpc("INTERNAL_SERVER_ERROR", "boom"), LANGS.en)).toBe(LANGS.en("native.saveUnsureBody"));
  });

  test("a status word this build does not know falls to the generic line, not to English", () => {
    expect(serverRefusal(trpc("BAD_REQUEST", "A paused order can't be closed"), LANGS.hi)).toBe(LANGS.hi("refusal.unknown"));
  });

  test("an answer that never came says to check first, a lapsed session says to sign in", () => {
    expect(serverRefusal(new RequestTimeoutError(60_000), LANGS.en)).toBe(LANGS.en("native.saveUnsureBody"));
    expect(serverRefusal({ message: "x", data: { code: "UNAUTHORIZED", httpStatus: 401 } }, LANGS.en)).toBe(LANGS.en("errors.sessionExpired"));
  });

  test("a refused confirm lists what the order still needs, one line each, in the language", () => {
    const lines = (t: (typeof LANGS)[keyof typeof LANGS]) =>
      serverRefusalLines(trpc("BAD_REQUEST", "Fill these before confirming: po_number, line_1_alloy, line_2_wat"), t, (c) => blockerText(c, t));
    expect(lines(LANGS.en).slice(0, 2)).toEqual(["Add the PO number.", "Line 1: add the alloy"]);
    expect(lines(LANGS.en)[2]).toBe(LANGS.en("refusal.unknown")); // an unknown blocker code is not echoed
    expect(lines(LANGS.hi)[0]).toBe(LANGS.hi("orders.blockers.po_number"));
    const edit = serverRefusalLines(trpc("BAD_REQUEST", "This order is confirmed; it still needs: po_number"), LANGS.en, (c) => blockerText(c, LANGS.en));
    expect(edit).toEqual(["This order is Confirmed. It still needs:", "Add the PO number."]);
  });

  test("mapSentence leaves a sentence it does not know alone", () => {
    expect(mapSentence("Something else entirely", LANGS.en)).toBeNull();
  });
});
