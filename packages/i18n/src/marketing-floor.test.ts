import { describe, expect, test } from "bun:test";

import { en } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";

/**
 * The homepage's "One refusal, three languages" figure shows the scanner's
 * refusal in English, Hindi and Gujarati. The route may not import a locale
 * file (the / budget check fails on any), so the three pairs are copied into
 * marketing.floor.* in both dictionaries. This test keeps the copies equal to
 * the strings the scanner really shows, so a copy edit in scan.continuous
 * cannot leave the homepage quoting words the app no longer says.
 */
describe("marketing.floor quotes the scanner word for word", () => {
  const sources = {
    refusedEn: en.scan.continuous.result.rejected,
    reasonEn: en.scan.continuous.wrongCustomerOther,
    refusedHi: hi.scan.continuous.result.rejected,
    reasonHi: hi.scan.continuous.wrongCustomerOther,
    refusedGu: gu.scan.continuous.result.rejected,
    reasonGu: gu.scan.continuous.wrongCustomerOther,
  } as const;

  for (const [key, expected] of Object.entries(sources)) {
    test(`en.ts marketing.floor.${key} equals its scan.continuous source`, () => {
      expect<string>(en.marketing.floor[key as keyof typeof sources]).toBe(expected);
    });

    test(`hi.ts marketing.floor.${key} equals its scan.continuous source`, () => {
      expect<string>(hi.marketing.floor[key as keyof typeof sources]).toBe(expected);
    });
  }

  test("the three languages differ from one another", () => {
    expect(new Set([sources.reasonEn, sources.reasonHi, sources.reasonGu]).size).toBe(3);
    expect(new Set([sources.refusedEn, sources.refusedHi, sources.refusedGu]).size).toBe(3);
  });
});
