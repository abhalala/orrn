import { describe, expect, test } from "bun:test";

import { formatterFor, screenPrefs } from "@orrn/domain";

import { parseWholeKgToGrams } from "@/features/die-room/die-room-model";
import { canonicalToDraft, DIAMETER_MM, draftToCanonical, draftToTyped, LENGTH_FT, LENGTH_IN, LENGTH_MM, MASS_G, MASS_KG, SECTION_KG12, keypadStep, typedToDraft, WALL_MM, WHOLE_KG } from "./plant-input";

const IST = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const fmtOf = (p: Parameters<typeof screenPrefs>[0] = {}) => formatterFor(screenPrefs(p), IST);

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("a plant that changed nothing: the box is the old box", () => {
  const f = fmtOf();
  test("typing is the draft, whatever is typed (no refusal added, no change of text)", () => {
    for (const [spec, text] of [[MASS_KG, "12.3456"], [MASS_KG, "1,280."], [MASS_KG, "abc"], [MASS_G, "250"], [LENGTH_MM, "3658.5"], [SECTION_KG12, "2.4"]] as const) {
      expect(typedToDraft(f, spec, text)).toMatchObject({ draft: text, problem: null });
      expect(draftToTyped(f, spec, text)).toBe(text);
    }
  });
});

describe("a plant on pounds: typing stores exact grams and reads back the same text", () => {
  const f = fmtOf({ units: { mass: "lb" } });
  test("115.6 lb is 52435 g, draft kg text 52.435, box shows 115.6 again", () => {
    const s = typedToDraft(f, MASS_KG, "115.6");
    expect(s).toMatchObject({ draft: "52.435", value: 52435, problem: null });
    expect(draftToTyped(f, MASS_KG, s.draft)).toBe("115.6");
    expect(draftToCanonical(MASS_KG, s.draft)).toBe(52435);
  });
  test("5,000 random pound texts of up to 2 decimals round trip through the model's draft", () => {
    const r = rng(5);
    for (let i = 0; i < 5000; i++) {
      const dec = Math.floor(r() * 3);
      const text = `${Math.floor(r() * 3000)}${dec ? "." + String(Math.floor(r() * 10 ** dec)).padStart(dec, "0") : ""}`;
      const s = typedToDraft(f, MASS_KG, text);
      expect(s.problem).toBeNull();
      const back = draftToTyped(f, MASS_KG, s.draft);
      expect(Number(back)).toBe(Number(text));
      // the model sees the very grams the box stored
      expect(draftToCanonical(MASS_KG, s.draft)).toBe(s.value);
    }
  });
  test("grams columns (nitriding) and kg per 12 ft columns convert the same way", () => {
    expect(typedToDraft(f, MASS_G, "0.5")).toMatchObject({ draft: "227", value: 227 });
    const lbft = fmtOf({ units: { linear_mass: "lb_ft" } });
    expect(typedToDraft(lbft, SECTION_KG12, "0.384")).toMatchObject({ problem: null });
    const kgm = fmtOf({ units: { linear_mass: "kg_m" } });
    expect(typedToDraft(kgm, SECTION_KG12, "0.571")).toMatchObject({ draft: "2.088", value: 2088 });
    expect(draftToTyped(kgm, SECTION_KG12, "2.088")).toBe("0.571");
  });
  test("text finer than the grid is refused: a blank draft and the reason", () => {
    expect(typedToDraft(f, MASS_KG, "115.555")).toEqual({ draft: "", value: null, problem: "decimals" });
    expect(typedToDraft(f, MASS_KG, "12abc")).toMatchObject({ draft: "", problem: "invalid" });
    expect(typedToDraft(f, MASS_KG, "")).toEqual({ draft: "", value: null, problem: null });
  });
});

describe("a plant on metres or feet and inches", () => {
  test("metres: typing 3.658 stores 3658 mm, draft '3658', reads 3.658", () => {
    const m = fmtOf({ units: { length: "m" } });
    const s = typedToDraft(m, LENGTH_MM, "3.658");
    expect(s).toMatchObject({ draft: "3658", value: 3658 });
    expect(draftToTyped(m, LENGTH_MM, "3658")).toBe("3.658");
    expect(typedToDraft(m, LENGTH_MM, "3.6584").problem).toBe("decimals");
    // foundry feet and inches boxes on a metre plant take metres too
    expect(typedToDraft(m, LENGTH_FT, "3.658")).toMatchObject({ draft: "12", value: 3658 });
    expect(typedToDraft(m, LENGTH_IN, "0.254")).toMatchObject({ draft: "10", value: 254 });
  });
  test("feet and inches plant: an mm box takes 12 ft 6 in and a feet or inch box is already in the plant's unit", () => {
    const fi = fmtOf({ units: { length: "ft_in" } });
    expect(typedToDraft(fi, LENGTH_MM, "12 ft 6 in")).toMatchObject({ draft: "3810", value: 3810 });
    expect(typedToDraft(fi, LENGTH_MM, "12' 6\"").value).toBe(3810);
    expect(draftToTyped(fi, LENGTH_MM, "3810")).toBe("12 ft 6 in");
    expect(typedToDraft(fi, LENGTH_MM, "12 ft 6.33 in").problem).toBe("decimals");
    expect(typedToDraft(fi, LENGTH_FT, "12.5")).toMatchObject({ draft: "12.5" });
  });
  test("a plant on mm keeps its feet and inch boxes as they are (foundry billet, tank gauge)", () => {
    expect(typedToDraft(fmtOf(), LENGTH_FT, "12.5")).toEqual({ draft: "12.5", value: 3810, problem: null });
    expect(typedToDraft(fmtOf(), LENGTH_IN, "144")).toMatchObject({ draft: "144" });
  });
});

describe("a feet and inches plant keeps its plain mm boxes (die wall, billet diameter, split cut)", () => {
  const fi = fmtOf({ units: { length: "ft_in" } });
  test("a wall typed 1.6 stays 1.6 mm, never 487.7", () => {
    expect(typedToDraft(fi, WALL_MM, "1.6")).toMatchObject({ draft: "1.6", problem: null });
    expect(typedToDraft(fi, WALL_MM, "1.6").draft).not.toBe("487.7");
    expect(draftToTyped(fi, WALL_MM, "1.2")).toBe("1.2");
    expect(draftToCanonical(WALL_MM, "1.2")).toBe(12);
  });
  test("a bare number in a box whose native unit is mm is never read as feet", () => {
    for (const text of ["1.2", "12", "127", "3658", "0.5"]) {
      expect(typedToDraft(fi, WALL_MM, text).draft).toBe(text);
      expect(typedToDraft(fi, DIAMETER_MM, text).draft).toBe(text);
    }
  });
  test("a billet diameter of 127 mm shows as 127 and types back as 127", () => {
    expect(draftToTyped(fi, DIAMETER_MM, "127")).toBe("127");
    expect(typedToDraft(fi, DIAMETER_MM, "127")).toMatchObject({ draft: "127", value: 127 });
  });
  test("a metre plant still converts the same boxes", () => {
    const m = fmtOf({ units: { length: "m" } });
    expect(typedToDraft(m, DIAMETER_MM, "0.127")).toMatchObject({ draft: "127" });
    expect(typedToDraft(m, WALL_MM, "0.0016")).toMatchObject({ draft: "1.6" });
  });
});

describe("draft helpers", () => {
  test("canonicalToDraft is the exact decimal in the model's unit", () => {
    expect(canonicalToDraft(MASS_KG, 52435)).toBe("52.435");
    expect(canonicalToDraft(MASS_KG, 12500)).toBe("12.5");
    expect(canonicalToDraft(MASS_G, 250)).toBe("250");
    expect(canonicalToDraft(LENGTH_FT, 3810)).toBe("12.5");
  });
});

describe("an on-screen keypad edits the text in the plant's unit", () => {
  const LIMIT = /^\d{0,4}(\.\d{0,4})?$/;
  const press = (f: ReturnType<typeof fmtOf>, keys: string[]) => {
    let typed = "";
    let draft = "";
    for (const k of keys) {
      const step = keypadStep(f, SECTION_KG12, typed, k, LIMIT);
      if (step) ({ typed, draft } = step);
    }
    return { typed, draft };
  };
  test("kg per metre: 2 . 5 is 2.5 kg/m, which is 9.144 kg per 12 ft (it was 2.5 kg per 12 ft)", () => {
    const f = fmtOf({ units: { linear_mass: "kg_m" } });
    const r = press(f, ["2", ".", "5"]);
    expect(r).toEqual({ typed: "2.5", draft: "9.144" });
    expect(draftToCanonical(SECTION_KG12, r.draft)).toBe(9144);
  });
  test("pounds per foot: 1 . 2 5 is 1.25 lb/ft", () => {
    const f = fmtOf({ units: { linear_mass: "lb_ft" } });
    const r = press(f, ["1", ".", "2", "5"]);
    expect(r.typed).toBe("1.25");
    expect(draftToCanonical(SECTION_KG12, r.draft)).toBe(Math.round(1.25 * 5443.10844));
  });
  test("back removes the last character of the typed text; a refused (too fine) text gives a blank draft", () => {
    const f = fmtOf({ units: { linear_mass: "kg_m" } });
    expect(press(f, ["2", ".", "5", "back"])).toEqual({ typed: "2.", draft: "7.315" });
    expect(press(f, ["2", ".", "5", "0", "0", "1"]).draft).toBe("");
  });
  test("a plant that changed nothing: the typed text and the draft are the same", () => {
    expect(press(fmtOf(), ["2", ".", "5"])).toEqual({ typed: "2.5", draft: "2.5" });
  });
});

describe("a model that keeps whole kg (die life) behind a converting box", () => {
  const lb = fmtOf({ units: { mass: "lb" } });
  const tonne = fmtOf({ units: { mass: "t" } });
  test("50000 lb is kept as 22680 kg and the model accepts it (it was 22679.619 and 'fields invalid')", () => {
    const s = typedToDraft(lb, WHOLE_KG, "50000");
    expect(s).toMatchObject({ draft: "22680", problem: null, value: 22_680_000 });
    expect(parseWholeKgToGrams(s.draft)).toBe(22_680_000);
  });
  test("every pound figure from 1 to 5000 lands on a whole kg the model accepts", () => {
    const bad: string[] = [];
    for (let n = 1; n <= 5000; n++) {
      const s = typedToDraft(lb, WHOLE_KG, String(n));
      if (n >= 2 && parseWholeKgToGrams(s.draft) === null) bad.push(`${n}: ${s.draft} ${s.problem}`);
    }
    expect(bad).toEqual([]);
  });
  test("tonnes: 22.6796 t is kept as 22680 kg", () => {
    expect(typedToDraft(tonne, WHOLE_KG, "22.6796")).toMatchObject({ draft: "22680", problem: null });
  });
  test("under half a kg is refused, zero is not", () => {
    expect(typedToDraft(lb, WHOLE_KG, "0.5")).toMatchObject({ draft: "", problem: "tooSmall" });
    expect(typedToDraft(lb, WHOLE_KG, "0")).toMatchObject({ draft: "0", problem: null });
  });
  test("what is kept reads back as the same whole kg (the box shows the kept figure)", () => {
    const kept = typedToDraft(lb, WHOLE_KG, "50000");
    const shown = draftToTyped(lb, WHOLE_KG, kept.draft);
    expect(typedToDraft(lb, WHOLE_KG, shown).draft).toBe("22680");
  });
  test("a plant on kg is the old box: the whole kg draft is the typed text", () => {
    expect(typedToDraft(fmtOf(), WHOLE_KG, "60000")).toMatchObject({ draft: "60000", problem: null });
  });
});
