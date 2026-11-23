import { describe, expect, test } from "bun:test";
import { ALLOY_LIMIT_SEEDS } from "@orrn/domain";

import { buildTimeline, chemistryOfMelt, cutTotals, nameOf, tempSummary, tempText, toMs } from "./data-sheet-model";

const limits6063 = ALLOY_LIMIT_SEEDS["6063"];

describe("chemistry against limits", () => {
  test("the seeded 6063 limits judge a result", () => {
    const c = chemistryOfMelt([{ id: "s", values: { si: 0.45, fe: 0.2, mg: 0.5 } }], limits6063);
    expect(c?.rows.length).toBeGreaterThan(3);
    expect(c?.outside).toEqual([]);
  });
  const limits = [
    { element: "si" as const, minPpm: 2_000, maxPpm: 6_000 },
    { element: "fe" as const, minPpm: null, maxPpm: 3_500 },
  ];
  test("an element over its limit is listed as outside", () => {
    const c = chemistryOfMelt([{ id: "s1", values: { si: 0.45, fe: 0.5 } }], limits);
    expect(c?.outside).toEqual(["fe"]);
    expect(c?.rows.find((r) => r.element === "si")?.reading).toBe("pass");
    expect(c?.verdict).not.toBe("pass");
  });
  test("a result inside every limit has nothing outside", () => {
    const c = chemistryOfMelt([{ id: "s1", values: { si: 0.45, fe: 0.2 } }], limits);
    expect(c?.outside).toEqual([]);
    expect(c?.resultId).toBe("s1");
  });
  test("the latest live result with numbers decides; a voided or numberless one never does", () => {
    const c = chemistryOfMelt(
      [
        { id: "old", values: { si: 0.45, fe: 0.2 } },
        { id: "photo", values: {} },
        { id: "void", voidedAt: new Date(), values: { si: 9, fe: 9 } },
      ],
      limits,
    );
    expect(c?.resultId).toBe("old");
    expect(chemistryOfMelt([{ id: "x", values: {} }], limits)).toBeNull();
    expect(chemistryOfMelt([], limits)).toBeNull();
  });
});

describe("temperatures", () => {
  const readings = [
    { meltId: "m1", kind: "furnace_temp", valueX10: 7_300, readAt: new Date(3_000) },
    { meltId: "m1", kind: "furnace_temp", valueX10: 7_100, readAt: new Date(1_000) },
    { meltId: "m2", kind: "furnace_temp", valueX10: 7_000, readAt: new Date(2_000) },
  ];
  test("count, range and the last reading by time", () => {
    expect(tempSummary(readings, "m1")).toEqual({ n: 2, minX10: 7_100, maxX10: 7_300, lastX10: 7_300 });
    expect(tempSummary(readings, "none")).toBeNull();
    expect(tempText(7_355)).toBe("735.5");
  });
});

describe("timeline", () => {
  const t = (n: number) => new Date(n * 60_000);
  const events = buildTimeline({
    melts: [
      { id: "m2", seq: 2, chargingStartAt: t(300), castingEndAt: t(400) },
      { id: "m1", seq: 1, preheatStartAt: t(0), chargingStartAt: t(60), chargingEndAt: t(120), castingStartAt: t(150), castingEndAt: t(200) },
    ],
    sheetMelts: [
      { id: "m1", createdBy: "u1", lockedBy: "u2" },
      { id: "m2", createdBy: "u1" },
    ],
    readings: [{ meltId: "m1", kind: "furnace_temp", valueX10: 7_200, readAt: t(90), createdBy: "u3" }],
    homog: [{ inAt: t(500), outAt: t(900), releasedBy: "u4" }],
    cuts: [{ cutAt: t(1_000), machine: "saw", createdBy: "u5" }],
    rejects: [{ rejectedAt: t(1_000), kind: "log", createdBy: "u5" }, { rejectedAt: null, kind: "billet" }],
  });
  test("oldest first across melts, readings, homogenizing, cuts and rejects", () => {
    expect(events.map((e) => e.kind)).toEqual(["preheat", "chargingStart", "reading", "chargingEnd", "castingStart", "castingEnd", "chargingStart", "castingEnd", "homogIn", "homogOut", "cut", "reject"]);
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort((a, b) => a - b));
  });
  test("melt times credit who locked the melt, else who made it; an event with no time is dropped", () => {
    expect(events.find((e) => e.kind === "preheat")?.actorId).toBe("u2");
    expect(events.find((e) => e.kind === "chargingStart" && e.meltSeq === 2)?.actorId).toBe("u1");
    expect(events.find((e) => e.kind === "reading")).toMatchObject({ actorId: "u3", detail: 7_200, meltSeq: 1 });
    expect(events.filter((e) => e.kind === "reject")).toHaveLength(1);
  });
  test("a cut and a reject at the same minute keep the work order", () => {
    expect(events.slice(-2).map((e) => e.kind)).toEqual(["cut", "reject"]);
  });
});

describe("totals and names", () => {
  test("cut totals and yield", () => {
    expect(cutTotals([{ logG: 1_000_000, billetG: 940_000 }, { logG: 1_000_000, billetG: 960_000 }])).toEqual({ logG: 2_000_000, billetG: 1_900_000, endG: 100_000, yieldBp: 9_500 });
    expect(cutTotals([])).toEqual({ logG: 0, billetG: 0, endG: 0, yieldBp: null });
  });
  test("names and dates", () => {
    expect([nameOf({ u1: "Asha" }, "u1"), nameOf({}, "u9"), nameOf({}, null)]).toEqual(["Asha", "-", "-"]);
    expect([toMs(new Date(5)), toMs("1970-01-01T00:00:00.010Z"), toMs(7), toMs(null), toMs("x")]).toEqual([5, 10, 7, null, null]);
  });
});
