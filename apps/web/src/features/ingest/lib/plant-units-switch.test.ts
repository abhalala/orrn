import { describe, expect, test } from "bun:test";
import { ORRN_DEFAULT_PREFS, readUnitSettings, screenPrefs } from "@orrn/domain";

import { assignField, columnEntries, emptyColumnMap, setColumnUnit } from "./mapping-model";
import { plantUnitsFromPrefs } from "./plant-units";
import { rowView } from "./rows-model";
import type { CandidateDetail, StagedRowView } from "./types";

/**
 * Item 5: the imports follow the plant's units like every other screen. The plant comes from its resolved preferences
 * (`me.company.units`, the set the plant formatter provider holds); a default plant reads kg and mm, a plant set to
 * pounds and metres reads those, in the review rows, the mapping preview and the lengths.
 */

const defaults = plantUnitsFromPrefs(ORRN_DEFAULT_PREFS);
const imperial = plantUnitsFromPrefs(screenPrefs(readUnitSettings({ units: { units: { mass: "lb", length: "m" } } })));

const candidate = { target: "bundles", block: { headers: ["Id", "Wt", "Length"] }, recipe: null } as unknown as Pick<CandidateDetail, "target" | "block" | "recipe">;
const row = {
  id: "r1", rowIndex: 0, state: "ready_create", values: { legacyId: "L1", weightG: 58_400, lengthMm: 3658 }, entered: null, raw: [], reasons: [],
  matchId: null, options: [], diff: null, decision: null, mergeState: "open", committedType: null, committedId: null, rate: null, rateHidden: false,
  doubts: [], doubtConfirmed: false,
} as unknown as StagedRowView;

const cell = (plant: typeof defaults, field: string) => {
  const c = rowView(candidate, row, plant).cells.find((x) => x.field === field)!;
  return c.unit ? `${c.text} ${c.unit}` : c.text;
};

describe("review rows follow the plant", () => {
  test("a default plant reads kg and mm, and a length is never grouped", () => {
    expect(cell(defaults, "weightG")).toBe("58.4 kg");
    expect(cell(defaults, "lengthMm")).toBe("3658 mm");
  });

  test("a plant set to pounds and metres reads pounds and metres", () => {
    expect(cell(imperial, "weightG")).toBe("128.75 lb");
    expect(cell(imperial, "lengthMm")).toBe("3.658 m");
  });

  test("the column headers carry the plant's unit", () => {
    expect([defaults.unitText("mass"), defaults.unitText("length")]).toEqual(["kg", "mm"]);
    expect([imperial.unitText("mass"), imperial.unitText("length")]).toEqual(["lb", "m"]);
  });
});

describe("the mapping preview and the samples", () => {
  const block = { headers: ["Id", "Wt", "Length"], kinds: ["text", "number", "number"], sample: [["L1", "58.4", "3658"], ["L2", "60", "3660"]] };
  const preview = (plant: typeof defaults, col: number, field: string, unit: string) => {
    let map = assignField(emptyColumnMap(block), col, field, "bundles", block);
    map = setColumnUnit(map, col, unit);
    return columnEntries(block as never, "bundles", map, plant, true)[col]!;
  };

  test("the preview is the first sample in the plant's unit; the samples stay as the file wrote them", () => {
    const a = preview(defaults, 1, "weightG", "kg");
    expect(a.preview).toMatchObject({ kind: "value", text: "58.4", unit: "kg" });
    const b = preview(imperial, 1, "weightG", "kg");
    expect(b.preview).toMatchObject({ kind: "value", text: "128.75", unit: "lb" });
    expect(a.samples.values).toEqual(["58.4", "60"]);
    expect(b.samples.values).toEqual(["58.4", "60"]);
  });

  test("a length column previews without grouping on both plants", () => {
    expect(preview(defaults, 2, "lengthMm", "mm").preview).toMatchObject({ kind: "value", text: "3658", unit: "mm" });
    expect(preview(imperial, 2, "lengthMm", "mm").preview).toMatchObject({ kind: "value", text: "3.658", unit: "m" });
  });

  test("a number of pieces is still grouped the plant's way", () => {
    expect(defaults.count(200_000)).toBe("2,00,000");
  });
});
