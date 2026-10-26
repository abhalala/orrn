import { describe, expect, test } from "bun:test";

import { LABEL_VARIABLES } from "@orrn/domain";

import { buildBundleLabelVariables, buildPackLabelVariables } from "../src/lib/bundle-label";

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

describe("cast placeholder", () => {
  test("prints the cast number when the bundle has one", () => {
    const v = buildBundleLabelVariables({ ...args({ castId: "c1" } as never), castRow: { number: "K31" } });
    expect(v.cast).toBe("K31");
  });

  test("is empty, never undefined, when there is no cast", () => {
    expect(buildBundleLabelVariables(args()).cast).toBe("");
    expect(buildBundleLabelVariables({ ...args(), castRow: null }).cast).toBe("");
  });
});

describe("label contract (BACKLOG 54)", () => {
  test("the variables a template gets are exactly @orrn/domain LABEL_VARIABLES, with no uuid", () => {
    const base = buildBundleLabelVariables(args());
    const pack = buildPackLabelVariables({
      bundleRow: { serial: "26J4086", partyNo: null, bisStandard: null, cmlNo: null, showLogo: true },
      qrUrl: "https://orrn.in/b/26J4086?c=fourcubes",
    });
    expect(Object.keys({ ...base, ...pack }).sort()).toEqual([...LABEL_VARIABLES].sort());
    expect("uuid" in base).toBe(false);
    // The QR names the number only, never the bundle's id.
    expect(pack.qr).toBe("https://orrn.in/b/26J4086?c=fourcubes");
  });
});
