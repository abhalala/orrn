import { describe, expect, test } from "bun:test";
import { createI18n } from "@orrn/i18n";

import { orderErrorLines } from "../orders/errors";
import { refusalText } from "../die-room/die-room-model";
import { mapSentence, serverRefusal, serverRefusalLines } from "./server-refusal";

const err = (code: string, message: string, meta?: Record<string, unknown>) => ({ message, data: { code, ...(meta ? { meta } : {}) } });


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

describe("the sentences with figures keep them, in every language", () => {
  test("a full press line, a file over its limit, a duplicate band", () => {
    const gu = createI18n("gu").t;
    const said = serverRefusal(gu, err("BAD_REQUEST", "P1 already has 13090-20 (PR-16) and 13090-21 (PR-17). Take one back, or record the die out of 13090-20, before issuing 13090-9."));
    expect(said).toContain("13090-20 (PR-16) અને 13090-21 (PR-17)");
  });
});
