import { describe, expect, test } from "bun:test";

import { changedDetails } from "./edit-details";

const shivam = { id: "c-shivam", name: "Shivam Aluminium" };
const patel = { id: "c-patel", name: "Patel Metals" };
const opened = { customer: shivam, shipDate: "2026-10-09", notes: "Load after lunch" };

describe("changedDetails", () => {
  test("nothing changed sends nothing", () => {
    expect(changedDetails(opened, { ...opened })).toEqual({});
    // Spaces typed around the notes are not a change.
    expect(changedDetails(opened, { ...opened, notes: " Load after lunch " })).toEqual({});
  });

  test("sends only the field that changed, so a value changed elsewhere is never put back", () => {
    expect(changedDetails(opened, { ...opened, customer: patel })).toEqual({ customerId: "c-patel" });
    expect(changedDetails(opened, { ...opened, shipDate: "2026-10-10" })).toEqual({ shipDate: Date.UTC(2026, 9, 10) });
    expect(changedDetails(opened, { ...opened, notes: "Truck at 4" })).toEqual({ notes: "Truck at 4" });
  });

  test("clearing a ship date or the notes sends null", () => {
    expect(changedDetails(opened, { ...opened, shipDate: "" })).toEqual({ shipDate: null });
    expect(changedDetails(opened, { ...opened, notes: "  " })).toEqual({ notes: null });
  });
});
