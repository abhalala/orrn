import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createI18n } from "@orrn/i18n";
import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";
import { mapSentence } from "@orrn/i18n/refusal";

import { foundryError, GATE_KEY, GATE_STEP, gateSentences, gateStep, isGate } from "../features/foundry/errors";
import { RequestTimeoutError } from "../lib/request-timeout";

/** The server's `MELT_GATE_TEXT`, read from its source (the router needs the Workers runtime). */
const source = readFileSync(join(import.meta.dir, "../../../packages/server/src/routers/foundryMelt.ts"), "utf8");
const block = /export const MELT_GATE_TEXT[^{]*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
const MELT_GATE_TEXT: Record<string, string> = Object.fromEntries([...block.matchAll(/^\s*(\w+): "([^"]+)",?$/gm)].map((m) => [m[1]!, m[2]!]));

type Tree = { readonly [key: string]: string | Tree };
const get = (tree: Tree, key: string) => key.split(".").reduce<string | Tree | undefined>((at, p) => (typeof at === "object" ? at[p] : undefined), tree);

describe("melt lock gates", () => {
  test("every server gate has a key, and nothing else", () => {
    expect(Object.keys(GATE_KEY).sort()).toEqual(Object.keys(MELT_GATE_TEXT).sort());
  });

  test("each gate's key is the one the server's sentence maps to (the screen and the refusal table agree)", () => {
    const t = ((k: string) => k) as never;
    for (const [code, sentence] of Object.entries(MELT_GATE_TEXT)) {
      const hit = mapSentence(sentence, t);
      expect({ code, key: hit?.key }).toEqual({ code, key: code === "times_out_of_order" ? "foundry.refusal.timesOrder" : GATE_KEY[code as keyof typeof GATE_KEY] });
    }
  });

  test("each key has en, hi and gu words, so a lock gate is said in the person's language", () => {
    for (const key of Object.values(GATE_KEY)) {
      expect({ key, en: typeof get(en as Tree, key) }).toEqual({ key, en: "string" });
      expect({ key, hi: typeof get(hi as unknown as Tree, key) }).toEqual({ key, hi: "string" });
      expect({ key, gu: typeof get(gu as unknown as Tree, key) }).toEqual({ key, gu: "string" });
    }
  });

  test("gateSentences says an unknown code as the generic line; a gate this build does not know has no step to jump to", () => {
    const t = ((k: string) => k) as never;
    expect(gateSentences(t, ["no_input", "mystery"])).toEqual(["foundry.refusal.addInput", "refusal.unknown"]);
    expect(isGate("no_logs")).toBe(true);
    expect(isGate("mystery")).toBe(false);
    expect(gateStep("no_logs")).toBe(GATE_STEP.no_logs);
    expect(gateStep("mystery")).toBeNull();
  });
});

describe("a refused foundry write is said in the person's language", () => {
  const refused = (message: string, code = "BAD_REQUEST") => ({ message, data: { code, httpStatus: code === "BAD_REQUEST" ? 400 : 409 } });

  test("a foundry sentence reaches the phone through the registered table, in English and in Hindi", () => {
    const en1 = createI18n("en").t;
    const hi1 = createI18n("hi").t;
    const sentence = "Only 120.5 kg left in LOT-41";
    expect(foundryError(en1 as never, refused(sentence))).toBe("Only 120.5 kg left in LOT-41.");
    const inHindi = foundryError(hi1 as never, refused(sentence));
    expect(inHindi).not.toBe("Only 120.5 kg left in LOT-41.");
    expect(inHindi).toContain("120.5");
    expect(inHindi).not.toMatch(/Only/);
  });

  test("the new r1 and r2 refusals are mapped", () => {
    const t = createI18n("en").t as never;
    for (const s of [
      "The count finds 3.2 kg more billets of K31 than the ledger; pick a reason",
      "Only 40 kg of Plant scrap is in stock",
      "No file is attached; say why the numbers are typed",
      "The spectro result changed; check it and lock again",
      "The billet store BILLET is retired; reactivate it to post the count, or reject the close",
    ]) {
      expect({ s, text: foundryError(t, refused(s)) }).not.toEqual({ s, text: createI18n("en").t("refusal.unknown") });
    }
  });

  test("a sentence this build does not know shows the generic line, never the server's English", () => {
    const t = createI18n("hi").t as never;
    const text = foundryError(t, refused("Some brand new sentence"));
    expect(text).toBe(createI18n("hi").t("refusal.unknown"));
  });

  test("an answer that never came is 'unsure', so nobody taps twice", () => {
    const t = createI18n("en").t as never;
    expect(foundryError(t, new RequestTimeoutError(60_000))).toBe(createI18n("en").t("native.saveUnsureBody"));
  });
});
