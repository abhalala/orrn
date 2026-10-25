import { describe, expect, test } from "bun:test";
import { createI18n } from "@orrn/i18n";
import { mapSentence } from "@orrn/i18n/refusal";
// W3-AG-S review I3: the ageing table is registered by its own module (an ageing screen imports it once).
import "@orrn/i18n/refusal-ageing";
import { AGEING_REFUSAL_CODES, type AgeingRefusalCode } from "@orrn/domain";
import { ageingRefusalMessage } from "@orrn/server/lib/ageingRefusals";

/**
 * W3-AG-C: every ageing refusal sentence the server can raise (lib/ageingRefusals.ts) is said from its
 * own `ageing.refusal.*` key in en, hi and gu, with the variables carried over and the status word
 * translated. The screens (W3-AG-W) call `serverRefusal(t, error)`; they never show the English.
 */
const KEY_ID: Partial<Record<AgeingRefusalCode, string>> = {
  recipe_max_soak_below_soak: "recipeMaxSoak",
  recipe_hardness_max_below_min: "recipeHardnessMax",
};
const camel = (c: string) => c.replace(/_([a-z])/g, (_, x: string) => x.toUpperCase());
const VARS = { oven: "OV-1", code: "T-1", batch: "AG-38", n: 43, serial: "26J12", cast: "K31", alloy: "6061", recipeAlloy: "6063", temper: "T6", recipeTemper: "T5", run: "PR-18", status: "in_oven" };

describe("ageing refusals in three languages", () => {
  test("each code's sentence maps to its own key", () => {
    const t = createI18n("en").t;
    for (const code of AGEING_REFUSAL_CODES) {
      const { message } = ageingRefusalMessage(code, VARS);
      const hit = mapSentence(message, t);
      expect({ code, key: hit?.key }).toEqual({ code, key: `ageing.refusal.${KEY_ID[code] ?? camel(code)}` as never });
    }
  });

  test("variables survive and the status word is the person's language", () => {
    for (const lang of ["en", "hi", "gu"] as const) {
      const t = createI18n(lang).t;
      const said = (code: AgeingRefusalCode) => {
        const hit = mapSentence(ageingRefusalMessage(code, VARS).message, t)!;
        return t(hit.key, hit.vars);
      };
      expect(said("trolley_busy")).toContain("AG-38");
      expect(said("over_line")).toContain("43");
      expect(said("alloy_mismatch")).toContain("K31");
      expect(said("wrong_status")).toContain(t("ageing.status.in_oven"));
      expect(said("bundle_not_aged")).toContain("26J12");
    }
  });

  test("Gujarati and Hindi never fall back to the English sentence", () => {
    for (const lang of ["hi", "gu"] as const) {
      const t = createI18n(lang).t;
      for (const code of AGEING_REFUSAL_CODES) {
        const { message } = ageingRefusalMessage(code, VARS);
        const hit = mapSentence(message, t)!;
        expect({ code, same: t(hit.key, hit.vars) === message }).toEqual({ code, same: false });
      }
    }
  });
});
