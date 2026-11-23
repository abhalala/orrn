import { describe, expect, test } from "bun:test";
import { computeLineRate, type PriceBreakup } from "@orrn/domain";

import { askedRate, breakupRows, pricingModuleOn, showsPriceSheet } from "./breakup-rows";

function build(over: Partial<Parameters<typeof computeLineRate>[0]> = {}): PriceBreakup {
  const r = computeLineRate({
    rateDate: "2026-11-20",
    metal: { source: "nalco", paisePerKg: 20_000, rateDate: "2026-11-18", rateId: "m1" },
    conversion: { paisePerKg: 4_000, from: "default", rateId: "c1" },
    alloy: { alloy: "6063", paisePerKg: 300, rateId: "a1" },
    finish: { finish: "anodise", paisePerKg: 1_500, rateId: "f1" },
    components: [{ key: "cutting", label: "Cutting", basis: "order", paise: 5_000, qty: 1, totalPaise: 5_000, rateId: "k1" }],
    kgG: 1_000_000,
    ...over,
  });
  if (!r.ok) throw new Error("missing");
  return r.breakup;
}

describe("breakupRows", () => {
  test("the master rate reads top to bottom and ends with the rate on the line", () => {
    const rows = breakupRows(build());
    expect(rows.map((r) => r.id)).toEqual(["metal", "conversion", "alloy", "finish", "addons", "final"]);
    expect(rows[0]).toMatchObject({ paise: 20_000, note: { type: "metal", source: "nalco", rateDate: "2026-11-18" } });
    expect(rows[1]).toMatchObject({ paise: 4_000, sign: "plus", note: { type: "conversion", from: "default" } });
    expect(rows[2]!.note).toEqual({ type: "name", name: "6063" });
    expect(rows[4]).toMatchObject({ paise: 5, note: { type: "addons", labels: ["Cutting"] } });
    expect(rows.at(-1)).toMatchObject({ id: "final", total: true, paise: 25_805 });
  });

  test("rows with nothing in them are left out; a discount is a minus", () => {
    const b = build({ alloy: null, finish: null, components: [], discountPaisePerKg: 200 });
    const rows = breakupRows(b);
    expect(rows.map((r) => r.id)).toEqual(["metal", "conversion", "discount", "final"]);
    expect(rows[2]).toMatchObject({ sign: "minus", paise: 200 });
    expect(rows.at(-1)!.paise).toBe(23_800);
  });

  test("a fixed rate replaces the parts", () => {
    const rows = breakupRows(build({ fixedPaisePerKg: 27_000 }));
    expect(rows.map((r) => r.id)).toEqual(["fixed", "final"]);
    expect(rows.at(-1)!.paise).toBe(27_000);
  });

  test("a rate changed by hand shows the computed rate, the change with its reason, then the final rate", () => {
    const b = build({ override: { ratePaise: 24_000, reason: "Long term party", rateId: "o1", approvalId: "ap1", approvedBy: "u2", requestedBy: "u1" } });
    const rows = breakupRows(b);
    expect(rows.map((r) => r.id)).toEqual(["metal", "conversion", "alloy", "finish", "addons", "computed", "override", "final"]);
    expect(rows[5]).toMatchObject({ id: "computed", total: true, paise: 25_805 });
    expect(rows[6]).toMatchObject({ id: "override", paise: 24_000, note: { type: "reason", reason: "Long term party" } });
    expect(rows.at(-1)!.paise).toBe(24_000);
  });
});

describe("asking for another rate", () => {
  test("below the computed rate waits for a manager; at or above does not", () => {
    const b = build();
    expect(askedRate(b, 25_000)).toMatchObject({ needsApproval: true, computedPaisePerKg: 25_805, sameAsNow: false });
    expect(askedRate(b, 25_805)).toMatchObject({ needsApproval: false, sameAsNow: true });
    expect(askedRate(b, 26_000).needsApproval).toBe(false);
  });
});

describe("when the sheet shows", () => {
  test("a breakup and the pricing module on", () => {
    const b = build();
    expect(showsPriceSheet(b, [])).toBe(true);
    expect(showsPriceSheet(b, ["Orders", "Pricing"])).toBe(true);
    expect(showsPriceSheet(b, ["orders"])).toBe(false);
    expect(showsPriceSheet(null, [])).toBe(false);
    expect(showsPriceSheet(undefined, undefined)).toBe(false);
    expect(pricingModuleOn(null)).toBe(true);
  });
});
