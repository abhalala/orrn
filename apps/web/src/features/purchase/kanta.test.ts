import { describe, expect, test } from "bun:test";

import { kgTextToG, readKanta, readKantaG } from "./kanta";

describe("kgTextToG", () => {
  test("reads what the kanta shows, commas allowed, into whole grams", () => {
    expect(kgTextToG("12,450")).toBe(12_450_000);
    expect(kgTextToG("12450.5")).toBe(12_450_500);
    expect(kgTextToG(" 0.125 ")).toBe(125);
  });

  test("empty, zero and junk are not a weight", () => {
    expect(kgTextToG("")).toBeNull();
    expect(kgTextToG("0")).toBeNull();
    expect(kgTextToG("12a")).toBeNull();
    expect(kgTextToG("-5")).toBeNull();
  });
});

describe("readKanta", () => {
  // 50 bp = 0.5 %: 12,450 kg party may be up to 62.25 kg short without a note.
  const TOL = 50;

  test("incomplete until both kantas are in", () => {
    expect(readKanta("12450", "", TOL).state).toBe("incomplete");
    expect(readKanta("", "12430", TOL).state).toBe("incomplete");
    expect(readKanta("", "", TOL).needsNote).toBe(false);
  });

  test("equal weights read as even", () => {
    const r = readKanta("8200", "8200", TOL);
    expect(r.state).toBe("even");
    expect(r.diffG).toBe(0);
    expect(r.shortG).toBe(0);
  });

  test("our kanta heavier is over, never needs a note", () => {
    const r = readKanta("5400", "5410", TOL);
    expect(r.state).toBe("over");
    expect(r.diffG).toBe(10_000);
    expect(r.needsNote).toBe(false);
  });

  test("short inside the tolerance is within", () => {
    const r = readKanta("12450", "12430", TOL);
    expect(r.state).toBe("within");
    expect(r.shortG).toBe(20_000);
    expect(r.toleranceG).toBe(62_250);
    expect(r.needsNote).toBe(false);
    expect(r.minNoteG).toBe(0);
  });

  test("exactly at the tolerance is still within (the server's rule is strictly beyond)", () => {
    // 10,000 kg party, 0.5 % = 50 kg.
    expect(readKanta("10000", "9950", TOL).state).toBe("within");
    expect(readKanta("10000", "9949.999", TOL).state).toBe("short");
  });

  test("short beyond the tolerance needs a note covering the part beyond it", () => {
    const r = readKanta("6540", "6320", TOL);
    expect(r.state).toBe("short");
    expect(r.shortG).toBe(220_000);
    expect(r.toleranceG).toBe(32_700);
    expect(r.needsNote).toBe(true);
    expect(r.minNoteG).toBe(220_000 - 32_700);
    // 220 / 6540 = 3.36 %.
    expect(r.shortBp).toBe(336);
  });

  test("tolerance comes from the company (0 bp: any short needs a note)", () => {
    expect(readKanta("1000", "999.9", 0).needsNote).toBe(true);
    expect(readKanta("1000", "990", 200).needsNote).toBe(false);
  });

  test("readKantaG takes stored grams, null FC is incomplete", () => {
    expect(readKantaG(6_540_000, null, TOL).state).toBe("incomplete");
    expect(readKantaG(6_540_000, 6_320_000, TOL).minNoteG).toBe(187_300);
  });
});
