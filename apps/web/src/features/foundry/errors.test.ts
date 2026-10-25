import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { gu } from "@orrn/i18n/gu";
import { hi } from "@orrn/i18n/hi";
import { mapSentence } from "@orrn/i18n/refusal";

import { GATE_KEY, GATE_STEP, gateSentences, gateStep, isGate } from "./errors";

/** The server's `MELT_GATE_TEXT`, read from its source (the router needs the Workers runtime). */
const source = readFileSync(join(import.meta.dir, "../../../../../packages/server/src/routers/foundryMelt.ts"), "utf8");
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
  test("each key has en, hi and gu words", () => {
    for (const key of Object.values(GATE_KEY)) {
      expect({ key, en: typeof get(en as Tree, key) }).toEqual({ key, en: "string" });
      expect({ key, hi: typeof get(hi as unknown as Tree, key) }).toEqual({ key, hi: "string" });
      expect({ key, gu: typeof get(gu as unknown as Tree, key) }).toEqual({ key, gu: "string" });
    }
  });
  test("gateSentences says an unknown code as the generic line", () => {
    const t = ((k: string) => k) as never;
    expect(gateSentences(t, ["no_input", "mystery"])).toEqual(["foundry.refusal.addInput", "refusal.unknown"]);
    expect(isGate("no_logs")).toBe(true);
    expect(isGate("mystery")).toBe(false);
    // A code this build does not know still counts as a gate (Lock waits) but has no step to jump to.
    expect(gateStep("no_logs")).toBe(GATE_STEP.no_logs);
    expect(gateStep("mystery")).toBeNull();
  });
});
