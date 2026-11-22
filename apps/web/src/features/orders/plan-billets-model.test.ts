import { describe, expect, test } from "bun:test";

import { billetDot, BILLET_DOT_KEY, BILLET_DOT_TONE, recoveryKey, rowsByLine, totalIsShort } from "./plan-billets-model";

describe("billetDot", () => {
  test("ready line is green", () => {
    const d = billetDot({ dieReady: true, billetsEnough: true, ready: true });
    expect(d).toBe("ready");
    expect(BILLET_DOT_TONE[d]).toBe("green");
    expect(BILLET_DOT_KEY[d]).toBe("reg.billet.ready");
  });
  test("no free die copy is amber", () => {
    const d = billetDot({ dieReady: false, billetsEnough: true, ready: false });
    expect(d).toBe("dieNotReady");
    expect(BILLET_DOT_TONE[d]).toBe("amber");
    expect(BILLET_DOT_KEY[d]).toBe("reg.billet.dieNotReady");
  });
  test("die ready but billets short is amber with the billets word", () => {
    const d = billetDot({ dieReady: true, billetsEnough: false, ready: false });
    expect(d).toBe("billetsShort");
    expect(BILLET_DOT_KEY[d]).toBe("reg.billet.billetsShort");
  });
  test("die problem wins when both are wrong", () => {
    expect(billetDot({ dieReady: false, billetsEnough: false, ready: false })).toBe("dieNotReady");
  });
});

describe("totalIsShort", () => {
  test("stock below need is short, equal is not", () => {
    expect(totalIsShort({ billetKgG: 1000, stockG: 999 })).toBe(true);
    expect(totalIsShort({ billetKgG: 1000, stockG: 1000 })).toBe(false);
    expect(totalIsShort({ billetKgG: 0, stockG: 0 })).toBe(false);
  });
});

describe("recoveryKey", () => {
  test("one key per source", () => {
    expect(recoveryKey("die")).toBe("reg.billet.recoveryDie");
    expect(recoveryKey("plant")).toBe("reg.billet.recoveryPlant");
    expect(recoveryKey("default")).toBe("reg.billet.recoveryDefault");
  });
});

describe("rowsByLine", () => {
  test("matches by plan line id", () => {
    const m = rowsByLine([{ planLineId: "a", n: 1 }, { planLineId: "b", n: 2 }]);
    expect(m.get("b")?.n).toBe(2);
    expect(m.get("x")).toBeUndefined();
  });
});
