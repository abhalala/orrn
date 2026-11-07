import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { hi } from "./hi";

describe("marketing product facts", () => {
  for (const [locale, messages] of Object.entries({ en: en.marketing, hi: hi.marketing })) {
    test(`${locale} keeps the anonymous yard count and its source`, () => {
      expect(messages.hero.proofFigure).toBe("1,071");
      expect(messages.hero.proof).toContain("1,721");
      expect(messages.hero.proof).toContain("1,071");
      expect(messages.hero.proof).toContain("30");
      expect(messages.hero.proof).not.toContain("FourCubes");
    });

    test(`${locale} says access needs no card and publishes no price`, () => {
      expect(messages.faq.q9.a).not.toContain("{{pricing}}");
      expect(messages.faq.q9.a).not.toMatch(/₹|\$/);
      expect(messages.keep.price.body).not.toMatch(/₹|\$/);
    });

    test(`${locale} keeps the role and guide counts together`, () => {
      expect(messages.benefits.floor.body).toContain("13");
      expect(messages.benefits.floor.body).toContain("44");
      expect(messages.proof.roles.length).toBeGreaterThan(0);
      expect(messages.proof.guides.length).toBeGreaterThan(0);
    });
  }
});
