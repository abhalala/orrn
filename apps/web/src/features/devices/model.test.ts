import { describe, expect, test } from "bun:test";

import { bpToPercentText, errorKey, healthTone, heartbeatFrom, importErrorKey, isCode, labValues, minWeightG, typedWeightG, percentTextToBp, tileTone, weighSubjectPath } from "./model";
import { parseDevicesSearch } from "./search";

describe("/devices search", () => {
  test("a tab and a reading kind are kept, anything else is dropped", () => {
    expect(parseDevicesSearch({})).toEqual({});
    expect(parseDevicesSearch({ tab: "devices" })).toEqual({});
    expect(parseDevicesSearch({ tab: "lab" })).toEqual({ tab: "lab" });
    expect(parseDevicesSearch({ tab: "readings", kind: "weighbridge" })).toEqual({ tab: "readings", kind: "weighbridge" });
    expect(parseDevicesSearch({ tab: "nope", kind: 7 })).toEqual({});
  });
});

describe("health chip and tile colours", () => {
  test("live is green, late amber, silent red, never and revoked neutral", () => {
    expect(["live", "late", "silent", "never", "revoked"].map((h) => healthTone(h as never))).toEqual(["green", "amber", "red", "neutral", "neutral"]);
  });
  test("the tile is red with any silent device, amber with any late one, green only when all are live", () => {
    expect(tileTone({ live: 2, late: 0, silent: 1, total: 3 })).toBe("red");
    expect(tileTone({ live: 2, late: 1, silent: 0, total: 3 })).toBe("amber");
    expect(tileTone({ live: 3, late: 0, silent: 0, total: 3 })).toBe("green");
    expect(tileTone({ live: 1, late: 0, silent: 0, total: 3 })).toBe("neutral");
  });
});

describe("tolerance percent and basis points", () => {
  test("basis points read as a percent and back", () => {
    for (const bp of [0, 5, 50, 100, 125, 1000]) expect(percentTextToBp(bpToPercentText(bp))).toBe(bp);
    expect(bpToPercentText(50)).toBe("0.5");
    expect(bpToPercentText(125)).toBe("1.25");
    expect(bpToPercentText(100)).toBe("1");
  });
  test("a percent over 10, finer than 2 decimals, or not a number is refused", () => {
    expect(percentTextToBp("10")).toBe(1000);
    for (const bad of ["10.01", "0.123", "abc", "", "2,5", "-1"]) expect(percentTextToBp(bad)).toBeNull();
  });
  test("the smallest difference is whole grams from kg text; zero is allowed, blank is not", () => {
    expect(minWeightG("20")).toBe(20_000);
    expect(minWeightG("0.5")).toBe(500);
    expect(minWeightG("0")).toBe(0);
    expect(minWeightG("")).toBeNull();
    expect(minWeightG("1001")).toBeNull();
  });
  test("a typed lot or truck weight runs to 200 tonnes, never zero", () => {
    expect(typedWeightG("18450")).toBe(18_450_000);
    expect(typedWeightG("200000")).toBe(200_000_000);
    for (const bad of ["", "0", "-5", "200001", "x"]) expect(typedWeightG(bad)).toBeNull();
  });
  test("heartbeat is a whole number from 10 to 3600", () => {
    expect(heartbeatFrom("60")).toBe(60);
    for (const bad of ["9", "3601", "1.5", "", "x"]) expect(heartbeatFrom(bad)).toBeNull();
  });
});

describe("small rules", () => {
  test("device codes", () => {
    expect(isCode("wb-1")).toBe(true);
    expect(isCode("W")).toBe(false);
    expect(isCode("a b")).toBe(false);
  });
  test("a failed write says its own sentence key", () => {
    expect(errorKey({ data: { code: "CONFLICT" } })).toBe("conflict");
    expect(errorKey({ data: { code: "NOT_FOUND" } })).toBe("notFound");
    expect(errorKey({ data: { code: "BAD_REQUEST" } })).toBe("bad");
    expect(errorKey(new Error("x"))).toBe("failed");
  });
  test("import line codes: unknown codes read as other", () => {
    expect(importErrorKey("bad_time")).toBe("bad_time");
    expect(importErrorKey("zzz")).toBe("other");
  });
  test("subjects link to the lot page or the dispatch page", () => {
    expect(weighSubjectPath("purchase_lot", "l1")).toBe("/purchase/l1");
    expect(weighSubjectPath("dispatch", "d1")).toBe("/dispatch/d1");
  });
  test("lab values: points for a scanner, MPa and percent for a tensile test", () => {
    expect(labValues("dimension", { points: [1, 2, 3] }).points).toBe(3);
    expect(labValues("mechanical", { tensileMpa: 210, yieldMpa: 160, elongationX10: 85 })).toMatchObject({ tensile: "210 MPa", yield: "160 MPa", elong: "8.5%" });
  });
});
