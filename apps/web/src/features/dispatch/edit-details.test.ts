import { describe, expect, test } from "bun:test";

import { changedDetails, shipDatePrefill } from "./edit-details";

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

describe("shipDatePrefill (review round 1, m10: the form opens on the day the page shows)", () => {
  test("an entered ship date opens on the server's ship day, whatever zone the browser is in", () => {
    // 20:00 UTC on the 4th is the 5th on the plant's clock: the hero says 5 Oct, so the form must too.
    expect(shipDatePrefill({ shipDate: "2026-10-04T20:00:00.000Z", shipDay: { ymd: "2026-10-05", kind: "ship" } })).toBe("2026-10-05");
    // A typed day (UTC midnight) round-trips.
    expect(shipDatePrefill({ shipDate: "2026-10-26T00:00:00.000Z", shipDay: { ymd: "2026-10-26", kind: "ship" } })).toBe("2026-10-26");
  });
  test("with no server day it falls back to the stored date's UTC day; none is blank; a day a load left is not a ship date", () => {
    expect(shipDatePrefill({ shipDate: "2026-10-26T00:00:00.000Z" })).toBe("2026-10-26");
    expect(shipDatePrefill({ shipDate: null })).toBe("");
    expect(shipDatePrefill({ shipDate: null, shipDay: { ymd: "2026-10-28", kind: "dispatched" } })).toBe("");
  });
});
