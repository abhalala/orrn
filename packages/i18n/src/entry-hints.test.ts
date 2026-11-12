import { expect, test } from "bun:test";

import { en } from "./en";
import { gu } from "./gu";
import { hi } from "./hi";

// A hint under an entry box names the unit the box takes. A plant on metres types metres in the cut length boxes, and a plant on
// lb/ft or kg/m types its own section unit in the band boxes, so each has a hint of its own (the mm and kg/12ft hints stay as they were).
test("the metre hints say metres and give a metre example", () => {
  for (const d of [en, hi] as const) {
    expect(d.pack.new.cutLengthHintMetres).toContain("3.658");
    expect(d.pack.new.cutLengthHintMetres).not.toContain("3658");
    expect(d.portal.orders.lengthHintMetres).toContain("3.658");
    expect(d.orders.form.lengthHintMetres.length).toBeGreaterThan(0);
  }
  expect(en.pack.new.cutLengthHintMetres).toBe("In metres, for example 3.658.");
  expect(en.pack.new.cutLengthHintMm).toBe("In millimetres, for example 3658.");
  expect(gu.pack.new.cutLengthHintMetres).toContain("3.658");
});

test("the band hint for another section unit names the section unit, not the plant's weight unit", () => {
  for (const d of [en, hi, gu] as const) {
    expect(d.dies.form.rangeHintUnit).toContain("{sectionUnit}");
    expect(d.dies.form.rangeHintUnit).not.toContain("{massUnit}");
  }
});
