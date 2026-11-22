import { describe, expect, test } from "bun:test";

import { buddyEn } from "./buddy/en";
import { buddyHi } from "./buddy/hi";
import { guBuddy } from "./gu-more/buddy";

type Tree = { readonly [key: string]: string | Tree };

function strings(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : strings(v, `${prefix}${k}.`)));
}

const hi = buddyHi as unknown as Tree;
const gu = guBuddy.buddy as unknown as Tree;

/**
 * Buddy fix round (review S11, N11): words on a Confirm card must say what Confirm runs. These lines read wrong in the
 * first build and are pinned here so they do not come back.
 */
describe("buddy words say what Confirm runs", () => {
  test("taking a sheet off hold says so in en, hi and gu (S11)", () => {
    expect(buddyEn.draft.titles.ingest_candidate_release).toBe("Take this sheet off hold");
    expect(buddyHi.draft.titles.ingest_candidate_release).toBe("इस शीट से रोक हटाएं");
    expect(guBuddy.buddy.draft.titles.ingest_candidate_release).toBe("આ શીટ પરથી રોક હટાવો");
  });

  test("a waiting draft is 'still to confirm', never 'on the way' (N11)", () => {
    for (const [key, value] of strings(hi)) expect({ key, value, hit: value.includes("राह में") }).toMatchObject({ hit: false });
    for (const [key, value] of strings(gu)) {
      if (key === "waiting") continue; // "waiting for you" is a real wait, not "on the way"
      expect({ key, value, hit: value.includes("રાહમાં") }).toMatchObject({ hit: false });
    }
    expect(buddyHi.draft.status.pending).toBe("पक्का होना बाकी");
    expect(guBuddy.buddy.draft.status.pending).toBe("પાકું કરવાનું બાકી");
  });

  test("a sheet is a sheet, not a bookish table (N11)", () => {
    for (const [key, value] of strings(hi)) expect({ key, hit: value.includes("तालिका") }).toEqual({ key, hit: false });
    for (const [key, value] of strings(gu)) expect({ key, hit: value.includes("કોષ્ટક") }).toEqual({ key, hit: false });
  });

  test("the other N11 lines", () => {
    expect(buddyHi.draft.titles.ingest_candidate_confirmNear).toBe("मिलता-जुलता नाम वही है या नहीं, बताएं");
    expect(guBuddy.buddy.draft.titles.ingest_candidate_confirmNear).toBe("મળતું આવતું નામ એ જ છે કે નહીં, કહો");
    expect(buddyHi.settings.outcome.truncated).toBe("हो गया (जवाब काटा गया)");
    expect(guBuddy.buddy.settings.outcome.truncated).toBe("થઈ ગયું (જવાબ કાપ્યો)");
    expect(guBuddy.buddy.newChat).toBe("નવી ચેટ");
  });

  test("revoke says that waiting changes expire (Cut off Hermes expires pending drafts)", () => {
    expect(buddyEn.settings.revokeBody).toContain("expire");
    expect(buddyEn.settings.revokeBody).not.toContain("stay in the list");
    expect(buddyHi.settings.revokeBody).toContain("समय खत्म");
    expect(guBuddy.buddy.settings.revokeBody).toContain("સમય પૂરો");
  });

  test("every input key on a draft card has a word in en, hi and gu", () => {
    const keys = Object.keys(buddyEn.field).sort();
    expect(Object.keys(buddyHi.field).sort()).toEqual(keys);
    expect(Object.keys(guBuddy.buddy.field).sort()).toEqual(keys);
    for (const k of ["candidateId", "artifactId", "answers", "questionCode", "subject", "answer", "target", "accept"]) expect(keys).toContain(k);
  });

  test("the two composite import drafts have titles in en, hi and gu", () => {
    for (const k of ["import_answerQuestions", "import_runDryRun"] as const) {
      expect(buddyEn.draft.titles[k].length).toBeGreaterThan(0);
      expect(buddyHi.draft.titles[k].length).toBeGreaterThan(0);
      expect(guBuddy.buddy.draft.titles[k].length).toBeGreaterThan(0);
    }
  });
});
