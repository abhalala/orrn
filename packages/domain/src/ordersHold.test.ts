/** FP-OP-17 "Hold stock against a line": the pure hold rules (`holdCheck`, `holdBlocksDispatch`, held kg in `planableG`). */
import { describe, expect, test } from "bun:test";

import { holdBlocksDispatch, holdCheck, MAX_HOLD_BUNDLES, planableG } from "./orders";

const line = { id: "L1", dieId: "d1", cutLengthMm: 3_658, open: true };
const yard = {
  status: "available",
  dieId: "d1",
  lengthMm: 3_658,
  salesOrderLineId: null,
  heldForLineId: null,
  onLiveDispatch: false,
  pendingReallocation: false,
};

describe("holdCheck", () => {
  test("a yard bundle of the line's die is held; same length, no warning", () => {
    expect(holdCheck({ bundle: yard, line })).toEqual({ ok: true, alreadyHeld: false, warnings: [] });
  });

  test("a bundle already on this line may be held (guards it for this customer)", () => {
    expect(holdCheck({ bundle: { ...yard, salesOrderLineId: "L1" }, line })).toEqual({ ok: true, alreadyHeld: false, warnings: [] });
  });

  test("a different cut length is allowed with a warning (like reallocate)", () => {
    expect(holdCheck({ bundle: { ...yard, lengthMm: 4_267 }, line })).toEqual({ ok: true, alreadyHeld: false, warnings: ["length_mismatch"] });
  });

  test("held for this line again is a calm no-op", () => {
    expect(holdCheck({ bundle: { ...yard, heldForLineId: "L1" }, line })).toEqual({ ok: true, alreadyHeld: true, warnings: [] });
  });

  test("refusals, in order", () => {
    expect(holdCheck({ bundle: yard, line: { ...line, open: false } })).toEqual({ ok: false, refusal: "line_closed" });
    for (const status of ["reserved", "dispatched", "void"]) {
      expect(holdCheck({ bundle: { ...yard, status }, line })).toEqual({ ok: false, refusal: "not_available" });
    }
    expect(holdCheck({ bundle: { ...yard, onLiveDispatch: true }, line })).toEqual({ ok: false, refusal: "on_dispatch" });
    expect(holdCheck({ bundle: { ...yard, pendingReallocation: true }, line })).toEqual({ ok: false, refusal: "pending_reallocation" });
    expect(holdCheck({ bundle: { ...yard, dieId: "d2" }, line })).toEqual({ ok: false, refusal: "die_mismatch" });
    expect(holdCheck({ bundle: { ...yard, salesOrderLineId: "L2" }, line })).toEqual({ ok: false, refusal: "other_line" });
    expect(holdCheck({ bundle: { ...yard, heldForLineId: "L2" }, line })).toEqual({ ok: false, refusal: "held_elsewhere" });
    // The first refusal wins: a closed line before a wrong die, a live dispatch before a wrong die.
    expect(holdCheck({ bundle: { ...yard, dieId: "d2" }, line: { ...line, open: false } })).toEqual({ ok: false, refusal: "line_closed" });
    expect(holdCheck({ bundle: { ...yard, dieId: "d2", onLiveDispatch: true }, line })).toEqual({ ok: false, refusal: "on_dispatch" });
  });

  test("at most 100 bundles per call", () => {
    expect(MAX_HOLD_BUNDLES).toBe(100);
  });
});

describe("holdBlocksDispatch", () => {
  test("held for another customer's open line: refused; for this customer: allowed; no hold: allowed", () => {
    expect(holdBlocksDispatch({ hold: { customerId: "anshu", orderOpen: true }, dispatchCustomerId: "bhavesh" })).toBe(true);
    expect(holdBlocksDispatch({ hold: { customerId: "anshu", orderOpen: true }, dispatchCustomerId: "anshu" })).toBe(false);
    expect(holdBlocksDispatch({ hold: null, dispatchCustomerId: "anshu" })).toBe(false);
  });

  test("a hold on a closed or cancelled order blocks nothing", () => {
    expect(holdBlocksDispatch({ hold: { customerId: "anshu", orderOpen: false }, dispatchCustomerId: "bhavesh" })).toBe(false);
  });
});

describe("planableG with held yard kg", () => {
  test("ordered 8 t, dispatched 3 t, packed 1 t, planned 1.5 t, pressed 0.5 t, held in yard 1.2 t -> 0.8 t", () => {
    expect(
      planableG({ orderedG: 8_000, dispatchedG: 3_000, packedG: 1_000, plannedG: 1_500, pressedG: 500, agedG: 0, heldYardG: 1_200 }),
    ).toBe(800);
  });

  test("held yard kg floors at 0 and defaults to none", () => {
    expect(planableG({ orderedG: 1_000, dispatchedG: 0, packedG: 0, plannedG: 0, pressedG: 0, agedG: 0, heldYardG: 1_500 })).toBe(0);
    expect(planableG({ orderedG: 1_000, dispatchedG: 0, packedG: 0, plannedG: 0, pressedG: 0, agedG: 0 })).toBe(1_000);
  });
});
