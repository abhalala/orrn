import { describe, expect, test } from "bun:test";

import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import { gu } from "@orrn/i18n/gu";

import {
  bannerOf,
  billetRows,
  CLOSE_GATE_CODES,
  clockOf,
  COUNT_STEPS,
  elapsedText,
  gateKey,
  gateSentences,
  isLastStep,
  kgTextToG,
  lineRows,
  movedOrder,
  percentOfBp,
  pollIntervalFor,
  qcRows,
  reorderTarget,
  splitQueue,
  stationActions,
  stepOfGate,
  stepStates,
  wholeText,
} from "./model";

const t = (key: string) => key;
const mm = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : null);
const dig = (tree: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], tree);

describe("gate text mapping", () => {
  test("every close gate code has a sentence in en, hi and gu (the station speaks the floor's language)", () => {
    for (const code of CLOSE_GATE_CODES) {
      const key = gateKey(code)!;
      expect({ code, en: typeof dig(en, key) }).toEqual({ code, en: "string" });
      expect({ code, hi: typeof dig(hi, key) }).toEqual({ code, hi: "string" });
      expect({ code, gu: typeof dig(gu, key) }).toEqual({ code, gu: "string" });
    }
  });

  test("an unknown code falls back to the server's sentence, then to the code", () => {
    expect(gateKey("brand_new_gate")).toBeNull();
    expect(gateSentences(["no_cast", "brand_new_gate", "other"], t, ["x", "Server says so"])).toEqual(["press.console.gates.no_cast", "Server says so", "other"]);
  });

  test("the refused-close sentences keep the server's order", () => {
    expect(gateSentences(["no_qc", "no_cast"], t)).toEqual(["press.console.gates.no_qc", "press.console.gates.no_cast"]);
  });
});

describe("station banner and actions", () => {
  test("queued is locked and has no Start; die_issued has Start; running has Stop", () => {
    expect(bannerOf("queued")).toBe("locked");
    expect(bannerOf("die_issued")).toBe("ready");
    expect(bannerOf("running")).toBe("running");
    expect(bannerOf("stopped")).toBe("stopped");
    expect(bannerOf("counting")).toBe("counting");
    expect(bannerOf("logged")).toBe("logged");
    expect(bannerOf("voided")).toBe("voided");
    const press = { run: true, close: false };
    expect(stationActions("queued", press).start).toBe(false);
    expect(stationActions("die_issued", press).start).toBe(true);
    expect(stationActions("running", press).stop).toBe(true);
    expect(stationActions("running", press).start).toBe(false);
    expect(stationActions("stopped", press).count).toBe(true);
  });

  test("Log run and Request reopen are for press.close holders only; a viewer gets nothing", () => {
    expect(stationActions("counting", { run: true, close: false }).logRun).toBe(false);
    expect(stationActions("counting", { run: true, close: true }).logRun).toBe(true);
    expect(stationActions("logged", { run: true, close: false }).requestReopen).toBe(false);
    expect(stationActions("logged", { run: true, close: true }).requestReopen).toBe(true);
    const none = stationActions("running", { run: false, close: false });
    expect(Object.values(none).every((v) => v === false)).toBe(true);
  });

  test("downtime only while running or stopped; handover on an open run", () => {
    const c = { run: true, close: false };
    expect(stationActions("running", c).downtime).toBe(true);
    expect(stationActions("counting", c).downtime).toBe(false);
    expect(stationActions("counting", c).handover).toBe(true);
    expect(stationActions("logged", c).handover).toBe(false);
  });

  test("a running run polls every 10 s, nothing else polls", () => {
    expect(pollIntervalFor("running")).toBe(10_000);
    expect(pollIntervalFor("counting")).toBe(false);
    expect(pollIntervalFor(undefined)).toBe(false);
  });
});

describe("counting stepper", () => {
  test("billets, pieces, butt and ends, rejects, remark and reading", () => {
    expect([...COUNT_STEPS]).toEqual(["billets", "pieces", "scrap", "rejects", "remark"]);
    expect(stepStates(2).map((s) => s.state)).toEqual(["done", "done", "current", "upcoming", "upcoming"]);
    expect(stepStates(-3)[0]!.state).toBe("current");
    expect(stepStates(99)[4]!.state).toBe("current");
    expect(isLastStep(4)).toBe(true);
    expect(isLastStep(3)).toBe(false);
  });

  test("a failing gate sends the person to the step that fixes it", () => {
    expect(stepOfGate("no_cast")).toBe(0);
    expect(stepOfGate("billet_short_reason_missing")).toBe(0);
    expect(stepOfGate("no_good")).toBe(1);
    expect(stepOfGate("good_over_input")).toBe(1);
    expect(stepOfGate("no_qc")).toBe(3);
    expect(stepOfGate("qc_note_missing")).toBe(3);
    expect(stepOfGate("downtime_open")).toBe(4);
    expect(stepOfGate("trial_result_missing")).toBe(4);
  });
});

describe("typed values", () => {
  test("kg text to grams and whole numbers", () => {
    expect(kgTextToG("155.2")).toBe(155_200);
    expect(kgTextToG("1,234.5")).toBe(1_234_500);
    expect(kgTextToG("")).toBeNull();
    expect(kgTextToG("abc")).toBeNull();
    expect(wholeText("80")).toBe(80);
    expect(wholeText("8.5")).toBeNull();
  });

  test("billet rows skip blank rows and refuse a half-typed one", () => {
    expect(billetRows([{ key: "a", lengthText: "600", countText: "4", kgText: "155.2" }, { key: "b", lengthText: "", countText: "", kgText: "" }], mm)).toEqual({
      rows: [{ lengthMm: 600, count: 4, kgG: 155_200 }],
    });
    expect(billetRows([{ key: "a", lengthText: "600", countText: "4", kgText: "" }], mm)).toEqual({ issue: "invalid" });
    expect(billetRows([{ key: "a", lengthText: "abc", countText: "4", kgText: "10" }], mm)).toEqual({ issue: "invalid" });
    expect(billetRows([{ key: "a", lengthText: "", countText: "4", kgText: "10" }], mm)).toEqual({ rows: [{ lengthMm: null, count: 4, kgG: 10_000 }] });
  });

  test("piece rows carry the plan line; kg may be blank only when pcs is blank too", () => {
    const ok = lineRows([{ key: "a", cutLengthMm: 3658, cutText: "", pcsText: "80", kgText: "234.2", pressPlanLineId: "pl1", orderNumber: "SO-1", releasedPcs: 100 }], mm);
    expect(ok).toEqual({ rows: [{ cutLengthMm: 3658, pcs: 80, goodG: 234_200, pressPlanLineId: "pl1" }] });
    expect(lineRows([{ key: "a", cutLengthMm: null, cutText: "", pcsText: "80", kgText: "1", pressPlanLineId: null, orderNumber: null, releasedPcs: null }], mm)).toEqual({ issue: "invalid" });
    expect(lineRows([{ key: "a", cutLengthMm: null, cutText: "3658", pcsText: "80", kgText: "1", pressPlanLineId: null, orderNumber: null, releasedPcs: null }], mm)).toEqual({
      rows: [{ cutLengthMm: 3658, pcs: 80, goodG: 1000, pressPlanLineId: null }],
    });
    expect(lineRows([{ key: "a", cutLengthMm: 3658, cutText: "", pcsText: "", kgText: "", pressPlanLineId: null, orderNumber: null, releasedPcs: null }], mm)).toEqual({ rows: [] });
  });

  test("a zero reject row is the 'none' check; a positive one carries reason and note", () => {
    expect(qcRows([{ key: "a", pcsText: "0", kgText: "0", reasonCodeId: "r", note: "x", runLine: 1 }])).toEqual({
      rows: [{ pcs: 0, kgG: 0, reasonCodeId: null, note: null, runLine: 1 }],
    });
    expect(qcRows([{ key: "a", pcsText: "3", kgText: "7", reasonCodeId: "bend", note: " ", runLine: null }])).toEqual({
      rows: [{ pcs: 3, kgG: 7000, reasonCodeId: "bend", note: null, runLine: null }],
    });
    expect(qcRows([{ key: "a", pcsText: "", kgText: "", reasonCodeId: "", note: "", runLine: null }])).toEqual({ rows: [] });
  });
});

describe("queue", () => {
  const cards = [
    { id: "r1", status: "running" },
    { id: "r2", status: "counting" },
    { id: "w1", status: "die_issued" },
    { id: "w2", status: "queued" },
    { id: "w3", status: "queued" },
  ];

  test("on the line and waiting never overlap (the QA 'queue 1, lists 2' contradiction)", () => {
    const { onLine, waiting } = splitQueue(cards);
    expect(onLine.map((c) => c.id)).toEqual(["r1", "r2"]);
    expect(waiting.map((c) => c.id)).toEqual(["w1", "w2", "w3"]);
    expect(onLine.length + waiting.length).toBe(cards.length);
  });

  test("move up / down targets stop at the ends", () => {
    const { waiting } = splitQueue(cards);
    expect(reorderTarget(waiting, "w1", "up")).toBeNull();
    expect(reorderTarget(waiting, "w1", "down")).toBe(1);
    expect(reorderTarget(waiting, "w3", "down")).toBeNull();
    expect(reorderTarget(waiting, "w3", "up")).toBe(1);
    expect(reorderTarget(waiting, "nope", "up")).toBeNull();
  });

  test("the optimistic order after a move", () => {
    const { waiting } = splitQueue(cards);
    expect(movedOrder(waiting, "w3", 0).map((c) => c.id)).toEqual(["w3", "w1", "w2"]);
    expect(movedOrder(waiting, "w1", 2).map((c) => c.id)).toEqual(["w2", "w3", "w1"]);
    expect(movedOrder(waiting, "w1", 99).map((c) => c.id)).toEqual(["w2", "w3", "w1"]);
  });
});

describe("formatting", () => {
  test("clock in the plant zone, elapsed, percent", () => {
    expect(clockOf(Date.UTC(2026, 9, 24, 8, 30), "Asia/Kolkata")).toBe("14:00");
    expect(clockOf(null)).toBe("");
    expect(elapsedText(72 * 60 * 1000 + 5000)).toBe("1:12:05");
    expect(elapsedText(125_000)).toBe("02:05");
    expect(percentOfBp(7545)).toBe("75.5");
    expect(percentOfBp(null)).toBe("");
  });
});
