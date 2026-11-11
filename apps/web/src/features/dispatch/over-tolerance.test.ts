import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { overToleranceText, tolerancePct } from "@/features/scan/scan-outcome";

import { overdrawView, overLineText } from "./over-tolerance";

const { t } = createI18n("en");
const line = { lineId: "l1", orderNumber: "SO-4", lineNo: 2, limitG: 1_050_000, totalG: 1_080_000, overG: 30_000, covered: false };

describe("tolerance at scan (pl-flow 61)", () => {
  test("the tolerance is said as the floor says it", () => {
    expect(tolerancePct(500)).toBe("5");
    expect(tolerancePct(250)).toBe("2.5");
  });

  test("the scan line names the added bundle's line only when this add took it over", () => {
    const report = {
      linked: [
        { serial: "26J2", salesOrderLineId: "l1", orderNumber: "SO-4", lineNo: 2 },
        { serial: "26J3", salesOrderLineId: "l9", orderNumber: "SO-5", lineNo: 1 },
      ],
      overTolerance: [{ ...line, toleranceBp: 500 }],
    };
    expect(overToleranceText(t, report, "26J2")).toBe("Over +5% on SO-4 line 2. A manager has to approve it before Dispatch.");
    expect(overToleranceText(t, report, "26J3")).toBeNull();
    expect(overToleranceText(t, {}, "26J2")).toBeNull();
  });

  test("the Complete sheet lists the uncovered lines and where the ask stands", () => {
    expect(overLineText(t, { toleranceBp: 500, orderNumber: "SO-4", lineNo: 2, overG: 30_000 })).toBe("Over +5% on SO-4 line 2: 30.00 kg over");
    const pending = overdrawView({ toleranceBp: 500, lines: [line, { ...line, lineId: "l2", covered: true }], approval: { id: "a", status: "pending", note: null } });
    expect(pending?.lines.map((l) => l.lineId)).toEqual(["l1"]);
    expect(pending?.statusKey).toBe("dispatch.overTolerance.pending");
    expect(overdrawView({ toleranceBp: 500, lines: [line], approval: { id: "a", status: "approved", note: null } })?.statusKey).toBe("dispatch.overTolerance.unasked");
    expect(overdrawView({ toleranceBp: 500, lines: [{ ...line, covered: true }], approval: null })).toBeNull();
    expect(overdrawView(null)).toBeNull();
  });
});
