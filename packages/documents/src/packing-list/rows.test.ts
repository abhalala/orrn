import { describe, expect, test } from "bun:test";

import { labelled, RECEIPT_UUID, unlabelled, v1Snapshot } from "./fixtures";
import { packingListModel } from "./rows";
import { parsePackingListSnapshot, safeParsePackingListSnapshot } from "./types";

describe("parsePackingListSnapshot", () => {
  test("reads the snapshot the server stores today", () => {
    const pl = parsePackingListSnapshot(unlabelled);
    expect(pl.dispatch.code).toBe("D-0042");
    expect(pl.items).toHaveLength(3);
    expect(pl.items[0]!.die.sectionCode).toBe("14701");
  });

  test("never carries the stored total length forward", () => {
    const pl = parsePackingListSnapshot(unlabelled) as Record<string, unknown>;
    expect(JSON.stringify(pl)).not.toContain("totalLengthM");
  });

  test("a broken snapshot is an error, not a page of blanks", () => {
    expect(safeParsePackingListSnapshot({ dispatch: { code: "D-1" } }).success).toBe(false);
    expect(() => parsePackingListSnapshot(null)).toThrow();
  });
});

describe("packingListModel", () => {
  test("rows carry the plant's columns, with kg/12ft and the billed weight range", () => {
    const { groups } = packingListModel(parsePackingListSnapshot(unlabelled));
    const rows = groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.sr)).toEqual([1, 2, 3]);
    const r4086 = rows.find((r) => r.bundleNo === "26I4086")!;
    expect(r4086).toMatchObject({ weightKg: 50.455, pcs: 20, cutLengthFt: 12, cutLengthIn: 144, kgPer12ft: 2.522, weightRange12ft: 2.5 });
    const r4101 = rows.find((r) => r.bundleNo === "26I4101")!;
    expect(r4101).toMatchObject({ cutLengthFt: 11.5, cutLengthIn: 138, kgPer12ft: 2.179, weightRange12ft: 2.1 });
  });

  test("kg per piece is weight over pieces to the gram, null without pieces (FP-PK-13)", () => {
    const rows = packingListModel(parsePackingListSnapshot(unlabelled)).groups.flatMap((g) => g.rows);
    expect(rows.find((r) => r.bundleNo === "26I4086")!.kgPerPiece).toBe(2.523); // 50.455 kg / 20 pcs
    const none = packingListModel(
      parsePackingListSnapshot({ ...unlabelled, items: unlabelled.items.map((i) => ({ ...i, quantity: 0 })) }),
    ).groups.flatMap((g) => g.rows);
    expect(none.every((r) => r.kgPerPiece === null)).toBe(true);
  });

  test("without packing group labels it groups by section, never by the packing session id", () => {
    const { groups } = packingListModel(parsePackingListSnapshot(unlabelled));
    expect(groups.map((g) => g.label)).toEqual(["14701 PATTI", "11250 ANGLE"]);
    expect(groups.map((g) => g.labelled)).toEqual([false, false]);
    for (const g of groups) {
      expect(g.key).not.toContain(RECEIPT_UUID);
      expect(g.label).not.toMatch(/dev-group/i);
    }
    expect(groups[0]!.rows.map((r) => r.bundleNo)).toEqual(["26I4087", "26I4086"]);
  });

  test("with labels it groups by label, in label order, and names the section", () => {
    const { groups } = packingListModel(parsePackingListSnapshot(labelled));
    expect(groups.map((g) => [g.label, g.dieLabel, g.bundles])).toEqual([
      ["A", "14701 PATTI", 2],
      ["B", "11250 ANGLE", 1],
    ]);
    expect(groups[0]!.labelled).toBe(true);
    expect(groups[0]!.weightKg).toBeCloseTo(102.855, 6);
    expect(groups[0]!.pieces).toBe(41);
  });

  test("an explicit groupLabel field wins over the legacy groupId", () => {
    const pl = parsePackingListSnapshot(
      v1Snapshot([
        { bundleSerial: "X1", die: { series: "TEE", sectionCode: "13090", name: "Tee 1¼\"" }, groupId: "OLD", groupLabel: null, quantity: 10, weightG: 25_000, lengthMm: 3658 },
      ]),
    );
    const { groups } = packingListModel(pl);
    expect(groups[0]!.label).toBe("13090 Tee 1¼\"");
    expect(groups[0]!.labelled).toBe(false);
  });

  test("totals are counted from the rows: bundles, pieces and kg", () => {
    const { totals } = packingListModel(parsePackingListSnapshot(unlabelled));
    expect(totals.bundles).toBe(3);
    expect(totals.pieces).toBe(65);
    expect(totals.weightKg).toBeCloseTo(152.971, 6);
  });

  test("header dates are calendar days in the company's time zone", () => {
    const late = parsePackingListSnapshot({
      ...unlabelled,
      dispatch: { ...unlabelled.dispatch, completedAt: "2026-10-03T20:00:00.000Z" },
    });
    expect(packingListModel(late, { timeZone: "Asia/Kolkata" }).header.date).toBe("2026-10-04");
    expect(packingListModel(late, { timeZone: "UTC" }).header.date).toBe("2026-10-03");
    expect(packingListModel(late).header.shipDate).toBe("2026-10-04");
  });

  test("the ship date is the picked calendar day in every time zone (stored as UTC midnight)", () => {
    const pl = parsePackingListSnapshot(unlabelled); // shipDate 2026-10-04T00:00:00.000Z
    for (const timeZone of ["America/New_York", "Pacific/Honolulu", "UTC", "Asia/Kolkata", "Pacific/Kiritimati"]) {
      expect(packingListModel(pl, { timeZone }).header.shipDate).toBe("2026-10-04");
    }
  });

  test("a bundle with no pieces or length has no kg/12ft rather than a wrong one", () => {
    const pl = parsePackingListSnapshot(
      v1Snapshot([{ bundleSerial: "Z1", die: { series: "FLAT", sectionCode: "14730" }, groupId: "", quantity: 0, weightG: 10_000, lengthMm: 3658 }]),
    );
    const row = packingListModel(pl).groups[0]!.rows[0]!;
    expect(row.kgPer12ft).toBeNull();
    expect(row.weightRange12ft).toBeNull();
  });
});
