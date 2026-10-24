import { describe, expect, test } from "bun:test";
import { createI18n } from "@orrn/i18n";

import { orderErrorLines, orderErrorText } from "./errors";

const en = createI18n("en").t;
const hi = createI18n("hi").t;
const err = (code: string, message: string) => ({ message, data: { code } });

describe("orderErrorLines", () => {
  test("confirm blockers become one sentence each", () => {
    expect(orderErrorLines(en, err("BAD_REQUEST", "Fill these before confirming: po_number, line_1_pcs"))).toEqual([
      "Add the PO number.",
      "Line 1: add pieces",
    ]);
  });

  test("a repeated PO is worded in the plant's language", () => {
    expect(orderErrorText(en, err("CONFLICT", "PO PO-4471 is already on SO-1 for this customer"))).toBe("PO PO-4471 is already on order SO-1.");
  });

  test("a plain server sentence is shown as it is (English), marked as the server's elsewhere", () => {
    expect(orderErrorText(en, err("BAD_REQUEST", "Nothing is left to plan on SO-4 line 1"))).toBe("Nothing is left to plan on SO-4 line 1");
    expect(orderErrorText(hi, err("BAD_REQUEST", "Nothing is left to plan on SO-4 line 1"))).toBe("सर्वर का जवाब: Nothing is left to plan on SO-4 line 1");
  });

  test("the refusals a line edit or a plan can meet are worded in the plant's language (review I-1, m-8)", () => {
    expect(orderErrorText(en, err("FORBIDDEN", "This die belongs to KD Extrusion"))).toBe("This die belongs to KD Extrusion.");
    expect(orderErrorText(hi, err("FORBIDDEN", "This die belongs to KD Extrusion"))).toBe("यह die KD Extrusion की है।");
    expect(
      orderErrorText(en, err("BAD_REQUEST", "Line 1, 2 is on a released press plan; its kg, pieces, length and section can't change now")),
    ).toBe("Line 1, 2 is on a released press plan. Its kg, pieces, length and die can't change now.");
    expect(orderErrorText(en, err("BAD_REQUEST", "1,200.000 kg is already dispatched on line 2, more than the new 1,100.000 kg"))).toBe(
      "Line 2: 1,200.000 kg is already dispatched, more than the new 1,100.000 kg.",
    );
  });

  test("a lost request reads as a network problem", () => {
    expect(orderErrorText(en, new Error("Failed to fetch"))).toBe(en("errors.network"));
  });
});
