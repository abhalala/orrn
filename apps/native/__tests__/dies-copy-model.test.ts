import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { bpPercent1 } from "@orrn/domain";
import { createI18n } from "@orrn/i18n";

import {
  applyPadKey,
  bandRangeText,
  copyAbilities,
  copyCodeQuery,
  copyIdFromLink,
  issueActions,
  issueLine,
  kgGroupedText,
  looksLikeCopyCode,
  milliKgText,
  parseHardness,
  parseKgToMilli,
  pctTenthText,
  runsForSection,
  statusTone,
  toneToChip,
  type PadKey,
} from "../features/dies/copy-model";
import { dieErrorText } from "../features/dies/errors";

const keys = (seq: string[]) => seq.reduce((text, k) => applyPadKey(text, k as PadKey), "");

describe("reading keypad (spec E1: readings keypad, the server computes the tone)", () => {
  test("keys build a weight: 5 . 9 6 7", () => {
    expect(keys(["5", ".", "9", "6", "7"])).toBe("5.967");
  });

  test("a point first becomes 0. and only one point is taken", () => {
    expect(keys(["."])).toBe("0.");
    expect(keys(["5", ".", ".", "2"])).toBe("5.2");
  });

  test("no more than three decimals and six whole digits", () => {
    expect(keys(["5", ".", "1", "2", "3", "4"])).toBe("5.123");
    expect(keys(["1", "2", "3", "4", "5", "6", "7"])).toBe("123456");
  });

  test("leading zeros collapse, backspace removes the last key", () => {
    expect(keys(["0", "0", "7"])).toBe("7");
    expect(keys(["5", ".", "9", "back", "back"])).toBe("5");
    expect(keys(["back"])).toBe("");
  });

  test("parseKgToMilli: 5.967 kg is 5967 g per 12 ft; blank, zero and over 500 kg are refused", () => {
    expect(parseKgToMilli("5.967")).toBe(5967);
    expect(parseKgToMilli("12")).toBe(12000);
    expect(parseKgToMilli("10.333")).toBe(10333);
    expect(parseKgToMilli("0.001")).toBe(1);
    expect(parseKgToMilli("")).toBeNull();
    expect(parseKgToMilli("0")).toBeNull();
    expect(parseKgToMilli("5.9671")).toBeNull();
    expect(parseKgToMilli("500.001")).toBeNull();
    expect(parseKgToMilli("abc")).toBeNull();
  });

  test("hardness is a whole number from 1", () => {
    expect(parseHardness("1050")).toBe(1050);
    expect(parseHardness(" 900 ")).toBe(900);
    expect(parseHardness("0")).toBeNull();
    expect(parseHardness("9.5")).toBeNull();
    expect(parseHardness("")).toBeNull();
  });
});

describe("figures are only worded, never worked out", () => {
  test("worked examples from the spec: 10.333 vs 10.000 is +3.3%, 5.967 vs 5.900 is +1.1%, 6.480 is +9.8%", () => {
    // The server sends 33, 11 and 98 tenths; the phone only writes them down.
    expect(pctTenthText(33)).toBe("+3.3%");
    expect(pctTenthText(11)).toBe("+1.1%");
    expect(pctTenthText(98)).toBe("+9.8%");
    expect(pctTenthText(-4)).toBe("-0.4%");
    expect(pctTenthText(0)).toBe("0.0%");
  });

  test("weights and bands as kg to three decimals", () => {
    expect(milliKgText(5967)).toBe("5.967");
    expect(bandRangeText(5900, 6200)).toBe("5.900–6.200");
    expect(kgGroupedText(8_000_000)).toBe("8,000");
  });

  test("tones and statuses map to the chip tones the web uses", () => {
    expect(toneToChip("red")).toBe("red");
    expect(toneToChip("under")).toBe("blue");
    expect(toneToChip("none")).toBe("neutral");
    expect(statusTone("available")).toBe("green");
    expect(statusTone("in_use")).toBe("blue");
    expect(statusTone("at_maker")).toBe("amber");
    expect(statusTone("retired")).toBe("neutral");
  });
});

describe("what the card offers (permission matrix x status)", () => {
  const all = () => true;
  const none = () => false;

  test("reading: any live copy for die.reading holders; retired copies take none", () => {
    expect(copyAbilities("available", all).reading).toBe(true);
    expect(copyAbilities("in_use", all).reading).toBe(true);
    expect(copyAbilities("retired", all).reading).toBe(false);
    expect(copyAbilities("available", none).reading).toBe(false);
  });

  test("nitriding out only from the rack, back only from nitriding, both need die.card", () => {
    expect(copyAbilities("available", all)).toMatchObject({ nitridingOut: true, nitridingBack: false });
    expect(copyAbilities("at_nitriding", all)).toMatchObject({ nitridingOut: false, nitridingBack: true });
    expect(copyAbilities("in_use", all)).toMatchObject({ nitridingOut: false, nitridingBack: false });
    expect(copyAbilities("available", (a) => a === "die.reading")).toMatchObject({ nitridingOut: false });
  });

  test("issue only from the rack and only for die.issue (die_room only)", () => {
    expect(copyAbilities("available", all).issue).toBe(true);
    expect(copyAbilities("at_maker", all).issue).toBe(false);
    expect(copyAbilities("available", (a) => a === "die.reading").issue).toBe(false);
  });

  test("a copy on trial cannot be issued from the rack button either (it is not available)", () => {
    expect(copyAbilities("on_trial", all).issue).toBe(false);
  });
});

describe("issue, return and cancel follow the domain rules the server uses", () => {
  test("before die-in: return and cancel both allowed", () => {
    expect(issueActions({ status: "die_issued", dieInAt: null, dieOutAt: null })).toEqual({ return: true, cancel: true, dieOnPress: false });
  });

  test("die in the press: neither, and the card says the die is on the press", () => {
    expect(issueActions({ status: "running", dieInAt: 1000, dieOutAt: null })).toEqual({ return: false, cancel: false, dieOnPress: true });
  });

  test("die out after the run: return allowed, cancel is not (the run started)", () => {
    expect(issueActions({ status: "stopped", dieInAt: 1000, dieOutAt: 2000 })).toEqual({ return: true, cancel: false, dieOnPress: false });
  });

  test("no run known: both allowed (the server decides)", () => {
    expect(issueActions(null)).toEqual({ return: true, cancel: true, dieOnPress: false });
  });
});

describe("issuing to a queued run (D13)", () => {
  const runs = [
    { id: "r1", number: "PR-1", sectionId: "s1", pressLineId: "p1", pressLineCode: "P1" },
    { id: "r2", number: "PR-2", sectionId: "s2", pressLineId: null, pressLineCode: null },
    { id: "r3", number: "PR-3", sectionId: "s1", pressLineId: null, pressLineCode: null },
  ];

  test("a copy can only go to a run of its own section", () => {
    expect(runsForSection(runs, "s1").map((r) => r.id)).toEqual(["r1", "r3"]);
    expect(runsForSection(runs, "nope")).toEqual([]);
  });

  test("the run decides the press line; a run without a line takes the only line, else the person picks", () => {
    expect(issueLine(runs[0]!, [{ id: "p9", code: "P9" }])).toBe("p1");
    expect(issueLine(runs[1]!, [{ id: "p9", code: "P9" }])).toBe("p9");
    expect(issueLine(runs[1]!, [{ id: "p1", code: "P1" }, { id: "p2", code: "P2" }])).toBeNull();
    expect(issueLine(runs[1]!, [])).toBeNull();
  });
});

describe("scanning a copy label (scan a copy code opens its card)", () => {
  test("copy codes: section code, hyphen, copy number; a slash is the same code", () => {
    expect(looksLikeCopyCode("12170-2")).toBe(true);
    expect(looksLikeCopyCode("12170/2")).toBe(true);
    expect(looksLikeCopyCode(" 2207-10 ")).toBe(true);
    expect(copyCodeQuery("12170/2")).toBe("12170-2");
  });

  test("bundle numbers and BG serials are not copy codes", () => {
    expect(looksLikeCopyCode("26J12")).toBe(false);
    expect(looksLikeCopyCode("BG-123")).toBe(false);
    expect(looksLikeCopyCode("2026-27/12")).toBe(false);
    expect(looksLikeCopyCode("")).toBe(false);
  });

  test("a QR holding a card link gives the copy id", () => {
    expect(copyIdFromLink("https://orrn.in/dies/copies/abc123")).toBe("abc123");
    expect(copyIdFromLink("https://orrn.in/dies/copies/abc%2D123?tab=readings")).toBe("abc-123");
    expect(copyIdFromLink("https://orrn.in/b/26J12")).toBeNull();
    expect(copyIdFromLink("12170-2")).toBeNull();
  });
});

describe("refusal wording (BACKLOG 29: never the server's English)", () => {
  const en = createI18n("en").t;
  const hi = createI18n("hi").t;
  const err = (code: string | undefined, message: string, meta?: Record<string, unknown>) => ({ data: code ? { code, httpStatus: code === "INTERNAL_SERVER_ERROR" ? 500 : 400, ...(meta ? { meta } : {}) } : undefined, message });

  test("the server's sentences name the copy and are said from the dictionary", () => {
    expect(dieErrorText(en, err("BAD_REQUEST", "12170-2 is retired; it takes no readings"))).toBe("12170-2 is retired. It takes no readings.");
    expect(dieErrorText(en, err("CONFLICT", "12170-2 or PR-4 changed meanwhile; nothing was issued"))).toBe(en("native.refusal.changed"));
    expect(dieErrorText(hi, err("CONFLICT", "12170-2 or PR-4 changed meanwhile; nothing was issued"))).toBe(hi("native.refusal.changed"));
  });

  test("an owned die names its owner; any other FORBIDDEN is the role wording", () => {
    expect(dieErrorText(en, err("FORBIDDEN", "This die belongs to KD Extrusion", { ownerName: "KD Extrusion" }))).toBe("This die belongs to KD Extrusion.");
    expect(dieErrorText(en, err("FORBIDDEN", "Missing permission die.issue"))).toBe(en("errors.forbidden"));
  });

  test("a validation failure (JSON text) and unexpected errors are never shown raw", () => {
    expect(dieErrorText(en, err("BAD_REQUEST", '[{"code":"too_small"}]'))).toBe(en("native.refusal.unknown"));
    expect(dieErrorText(en, err("INTERNAL_SERVER_ERROR", "boom"))).toBe(en("native.saveUnsureBody"));
    expect(dieErrorText(en, new Error("Network request failed"))).toBe(en("native.saveUnsureBody"));
  });
});

describe("recovery percent (I-4: half away from zero, no client arithmetic)", () => {
  test("7835 bp shows 78.4, not the 78.3 that toFixed gives", () => {
    expect(bpPercent1(7835)).toBe("78.4");
    expect(bpPercent1(7545)).toBe("75.5");
    expect(bpPercent1(286)).toBe("2.9");
    expect(bpPercent1(10000)).toBe("100.0");
    expect(bpPercent1(0)).toBe("0.0");
  });

  test("no screen divides basis points itself: toFixed(1) on a bp value is gone from the phone", () => {
    const root = join(import.meta.dir, "..");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) return [];
        const full = join(dir, e.name);
        return e.isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(e.name) ? [full] : [];
      });
    const bad = ["app", "features", "components", "lib"]
      .flatMap((d) => walk(join(root, d)))
      .filter((f) => /[bB]p\b[^\n]*(toFixed|\/ 100)|(toFixed|\/ 100)[^\n]*[bB]p\b/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
    expect(readFileSync(join(root, "features/dies/copy-card.tsx"), "utf8")).toMatch(/bpPercent1\(r\.recoveryBp\)/);
  });
});
