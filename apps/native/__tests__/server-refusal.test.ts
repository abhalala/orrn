import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { blockerText } from "../features/orders/order-model";
import { RequestTimeoutError } from "../lib/request-timeout";
import { mapSentence, serverRefusal, serverRefusalLines } from "../lib/server-refusal";


describe("what a person is told", () => {
  const trpc = (code: string, message: string, meta?: Record<string, unknown>) => ({ message, data: { code, httpStatus: code === "INTERNAL_SERVER_ERROR" ? 500 : 400, ...(meta ? { meta } : {}) } });
  const LANGS = { en: createI18n("en").t, hi: createI18n("hi").t, gu: createI18n("gu").t } as const;

  test("a known refusal is said from the dictionary with its names", () => {
    expect(serverRefusal(trpc("BAD_REQUEST", "12170-2 is issued to a press; it cannot be sent to nitriding"), LANGS.hi)).toContain("12170-2");
    expect(serverRefusal(trpc("BAD_REQUEST", "12170-2 is out at nitriding"), LANGS.hi)).not.toMatch(/[A-Za-z]{4,} (?:can't|is|has)/);
    expect(serverRefusal(trpc("CONFLICT", "12170-2 or PR-4 changed meanwhile; nothing was issued"), LANGS.gu)).not.toContain("meanwhile");
  });

  test("the words the server names are the app's own, per language", () => {
    const m = "Only a booking can be confirmed (this order is closed)";
    expect(serverRefusal(trpc("BAD_REQUEST", m), LANGS.hi)).toContain(LANGS.hi("orders.status.closed"));
    expect(serverRefusal(trpc("BAD_REQUEST", m), LANGS.gu)).toContain(LANGS.gu("orders.status.closed"));
  });

  test("an owned die names its owner, from the server's meta first", () => {
    expect(serverRefusal(trpc("FORBIDDEN", "This die belongs to KD Extrusion"), LANGS.hi)).toBe(LANGS.hi("refusal.owned", { name: "KD Extrusion" }));
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
    expect(lines(LANGS.en)[2]).toBe(LANGS.en("refusal.unknown")); // an unknown blocker code is not echoed
    expect(lines(LANGS.hi)[0]).toBe(LANGS.hi("orders.blockers.po_number"));
  });

  test("mapSentence leaves a sentence it does not know alone", () => {
    expect(mapSentence("Something else entirely", LANGS.en)).toBeNull();
  });
});
