import { describe, expect, test } from "bun:test";
import { createI18n } from "@orrn/i18n";

import { orderErrorLines, orderErrorText } from "./errors";

const en = createI18n("en").t;
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

  test("a plain server sentence is shown as it is", () => {
    expect(orderErrorText(en, err("FORBIDDEN", "This die belongs to KD Extrusion"))).toBe("This die belongs to KD Extrusion");
  });

  test("a lost request reads as a network problem", () => {
    expect(orderErrorText(en, new Error("Failed to fetch"))).toBe(en("errors.network"));
  });
});
