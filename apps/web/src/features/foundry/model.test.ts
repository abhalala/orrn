import { describe, expect, test } from "bun:test";

import { ALLOY_LIMIT_SEEDS } from "@orrn/domain";

import {
  bpText,
  canCancelCast,
  castPeriodText,
  closeBlock,
  closeFormIssue,
  furnaceInput,
  limitDraft,
  limitRows,
  limitText,
  lockedMeltTone,
  parseCastsSearch,
  ppmPct,
  spectroInput,
  spectroRows,
  tailChip,
  todayCounts,
  traceQuery,
  verdictTone,
} from "./model";

describe("tone and chips", () => {
  test("verdict tones: a fail is red, a pass green, incomplete amber, none neutral", () => {
    expect([verdictTone("pass"), verdictTone("fail"), verdictTone("incomplete"), verdictTone(null)]).toEqual(["green", "red", "amber", "neutral"]);
  });
  test("a locked melt is green only with a pass and burn inside 3 %", () => {
    expect(lockedMeltTone({ verdict: "pass", lossBp: 286, warnings: [] })).toBe("green");
    expect(lockedMeltTone({ verdict: "pass", lossBp: 480, warnings: [{}] })).toBe("amber");
    expect(lockedMeltTone({ verdict: null, lossBp: 100, warnings: [] })).toBe("amber");
    expect(lockedMeltTone({ verdict: "fail", lossBp: 100, warnings: [] })).toBe("red");
  });
  test("the tail chip: balanced green, a tail amber, a tail needing approval or billets short red, nothing yet neutral", () => {
    const base = { producedG: 5_860_000, tailG: 0, shortG: 0, needsApproval: false, liveMelts: 1 };
    expect(tailChip(base)).toEqual({ tone: "green", kind: "balanced" });
    expect(tailChip({ ...base, tailG: 20_000 })).toEqual({ tone: "amber", kind: "tail" });
    expect(tailChip({ ...base, tailG: 400_000, needsApproval: true })).toEqual({ tone: "red", kind: "tail" });
    expect(tailChip({ ...base, shortG: 5_000, tailG: -5_000 })).toEqual({ tone: "red", kind: "short" });
    expect(tailChip({ producedG: 0, tailG: 0, shortG: 0, needsApproval: false, liveMelts: 0 })).toEqual({ tone: "neutral", kind: "empty" });
  });
  test("bpText and the period", () => {
    expect(bpText(286)).toBe("2.9");
    expect(bpText(null)).toBe("");
    expect(castPeriodText(2026, 10)).toBe("Oct 2026");
  });
});

describe("close and cancel", () => {
  test("a draft melt blocks the close; a closed cast cannot be closed again", () => {
    expect(closeBlock("open", { draftMelts: 1 })).toBe("draft_melts");
    expect(closeBlock("open", { draftMelts: 0 })).toBeNull();
    expect(closeBlock("closing", { draftMelts: 0 })).toBe("not_open");
  });
  test("a reason is asked only when the tail needs one, and 'other' needs a note", () => {
    const reasons = [{ code: "scale_difference", requiresNote: false }, { code: "other", requiresNote: true }];
    expect(closeFormIssue({ needsReason: false }, { reasonCode: "", note: "" }, reasons)).toBeNull();
    expect(closeFormIssue({ needsReason: true }, { reasonCode: "", note: "" }, reasons)).toBe("reason");
    expect(closeFormIssue({ needsReason: true }, { reasonCode: "other", note: " " }, reasons)).toBe("note");
    expect(closeFormIssue({ needsReason: true }, { reasonCode: "other", note: "pit spill" }, reasons)).toBeNull();
    expect(closeFormIssue({ needsReason: true }, { reasonCode: "scale_difference", note: "" }, reasons)).toBeNull();
  });
  test("cancel only an empty open cast", () => {
    expect(canCancelCast("open", { liveMelts: 0, draftMelts: 0 })).toBe(true);
    expect(canCancelCast("open", { liveMelts: 1, draftMelts: 0 })).toBe(false);
    expect(canCancelCast("open", { liveMelts: 0, draftMelts: 1 })).toBe(false);
    expect(canCancelCast("closed", { liveMelts: 0, draftMelts: 0 })).toBe(false);
  });
});

describe("search", () => {
  test("only a known status and a short query survive", () => {
    expect(parseCastsSearch({ status: "open", q: " k31 " })).toEqual({ status: "open", q: "k31" });
    expect(parseCastsSearch({ status: "nope", q: "" })).toEqual({});
    expect(parseCastsSearch({ q: "x".repeat(41) })).toEqual({});
  });
  test("the trace box tells a cast code from a bundle serial", () => {
    expect(traceQuery("k31")).toEqual({ kind: "cast", number: "K31" });
    expect(traceQuery(" 26J1842 ")).toEqual({ kind: "bundle", serial: "26J1842" });
    expect(traceQuery("hello")).toBeNull();
    expect(traceQuery("")).toBeNull();
  });
});

describe("spectro rows", () => {
  const limits = ALLOY_LIMIT_SEEDS["6063"];
  const pass = { si: 0.42, fe: 0.18, cu: 0.02, mn: 0.03, mg: 0.52, zn: 0.01, ti: 0.02, cr: 0.01 };
  test("a result inside the 6063 limits passes, with Al as the balance", () => {
    const r = spectroRows(pass, limits)!;
    expect(r.verdict).toBe("pass");
    const al = r.rows.find((x) => x.element === "al")!;
    expect(al.source).toBe("balance");
    expect(ppmPct(al.ppm)).toBe("98.790");
    expect(r.rows.find((x) => x.element === "mg")!.reading).toBe("pass");
  });
  test("iron above 0.35 fails and says which element", () => {
    const r = spectroRows({ ...pass, fe: 0.41 }, limits)!;
    expect(r.verdict).toBe("fail");
    expect(r.rows.filter((x) => x.reading === "fail").map((x) => x.element)).toEqual(["fe"]);
  });
  test("fewer than eight elements is incomplete", () => {
    expect(spectroRows({ si: 0.4, mg: 0.5 }, limits)!.verdict).toBe("incomplete");
  });
  test("impossible values give null (the screen shows the stored verdict only)", () => {
    expect(spectroRows({ ...pass, si: 120 }, limits)).toBeNull();
  });
  test("limit text", () => {
    const words = { max: "max", min: "min", to: "to" };
    expect(limitText({ minPpm: 2000, maxPpm: 6000 }, words)).toBe("0.20 to 0.60");
    expect(limitText({ minPpm: null, maxPpm: 3500 }, words)).toBe("max 0.35");
    expect(limitText({ minPpm: 4500, maxPpm: null }, words)).toBe("min 0.45");
    expect(limitText(undefined, words)).toBe("");
  });
});

describe("spectro typed entry", () => {
  test("percent text becomes whole ppm, blank elements are skipped", () => {
    expect(spectroInput({ si: "0.42", mg: "0,52", fe: "" })).toEqual({ ok: true, valuesPpm: { si: 4200, mg: 5200 } });
  });
  test("nothing typed, a bad number and a sum over 100 % are refused", () => {
    expect(spectroInput({})).toEqual({ ok: false, element: "si", reason: "none" });
    expect(spectroInput({ si: "0.42", fe: "abc" })).toEqual({ ok: false, element: "fe", reason: "invalid" });
    expect(spectroInput({ si: "60", fe: "50" })).toEqual({ ok: false, element: "si", reason: "over" });
  });
});

describe("limits editor", () => {
  test("seeded 6063 limits show as percent and go back as the same ppm", () => {
    const draft = limitDraft(ALLOY_LIMIT_SEEDS["6063"]);
    expect(draft.si).toEqual({ min: "0.2", max: "0.6" });
    expect(draft.fe).toEqual({ min: "", max: "0.35" });
    expect(draft.al).toEqual({ min: "", max: "" });
    const back = limitRows(draft);
    expect(back).toEqual({ ok: true, limits: ALLOY_LIMIT_SEEDS["6063"].map((l) => ({ ...l })) });
  });
  test("a minimum above its maximum and a bad cell name the element", () => {
    const d = limitDraft([]);
    d.mg = { min: "0.9", max: "0.45" };
    expect(limitRows(d)).toEqual({ ok: false, element: "mg", reason: "order" });
    const e = limitDraft([]);
    e.cu = { min: "", max: "x" };
    expect(limitRows(e)).toEqual({ ok: false, element: "cu", reason: "invalid" });
  });
});

describe("furnace form", () => {
  test("code is upper-cased, capacity kg becomes grams", () => {
    expect(furnaceInput({ code: " f2 ", name: "Furnace 2", capacityKg: "6000", billetDiaMm: "127" })).toEqual({ ok: true, code: "F2", name: "Furnace 2", capacityG: 6_000_000, billetDiaMm: 127 });
  });
  test("each bad field is named", () => {
    expect(furnaceInput({ code: "f 2", name: "x", capacityKg: "6000", billetDiaMm: "127" })).toEqual({ ok: false, field: "code" });
    expect(furnaceInput({ code: "F2", name: " ", capacityKg: "6000", billetDiaMm: "127" })).toEqual({ ok: false, field: "name" });
    expect(furnaceInput({ code: "F2", name: "x", capacityKg: "0", billetDiaMm: "127" })).toEqual({ ok: false, field: "capacity" });
    expect(furnaceInput({ code: "F2", name: "x", capacityKg: "6000", billetDiaMm: "5" })).toEqual({ ok: false, field: "dia" });
  });
});

describe("Today tile", () => {
  test("open casts, drafts on them and waiting files", () => {
    const casts = [
      { status: "open", draftMelts: 1 },
      { status: "open", draftMelts: 0 },
      { status: "closing", draftMelts: 0 },
      { status: "closed", draftMelts: 0 },
    ];
    expect(todayCounts(casts, 3)).toEqual({ openCasts: 3, meltsInProgress: 1, spectroPending: 3 });
    expect(todayCounts([], 0)).toEqual({ openCasts: 0, meltsInProgress: 0, spectroPending: 0 });
  });
});
