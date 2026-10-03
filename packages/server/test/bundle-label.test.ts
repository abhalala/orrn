import { describe, expect, test } from "bun:test";

import { buildBundleLabelVariables } from "../src/lib/bundle-label";

type Args = Parameters<typeof buildBundleLabelVariables>[0];

function args(over: Partial<Args["bundleRow"]> = {}, unit = "mm"): Args {
  return {
    bundleRow: {
      id: "b1",
      serial: "BG-000001-B001",
      quantity: 21,
      weightG: 52_400,
      lengthMm: 3_658,
      ...over,
    } as Args["bundleRow"],
    groupRow: { unit, purchaseOrderRef: "PO-7" } as Args["groupRow"],
    dieRow: { series: "T" } as Args["dieRow"],
    layout: "x1",
  };
}

describe("buildBundleLabelVariables", () => {
  test("weight12ft is kg per 12 ft piece, not per foot", () => {
    const v = buildBundleLabelVariables(args());
    expect(v.weight12ft).toBe("2.495 kg/12ft");
  });

  test("other outputs are unchanged", () => {
    const v = buildBundleLabelVariables(args());
    expect(v).toMatchObject({
      length: "3658 mm",
      poNumber: "PO-7",
      quantity: "21",
      serialNumber: "BG-000001-B001",
      seriesName: "T",
      uuid: "b1",
      weight: "52.4 kg",
      weight_each: "2.495",
      layout: "x1",
    });
  });

  test("zero pieces gives an em dash, not NaN", () => {
    const v = buildBundleLabelVariables(args({ quantity: 0 }));
    expect(v.weight12ft).toBe("— kg/12ft");
  });
});
