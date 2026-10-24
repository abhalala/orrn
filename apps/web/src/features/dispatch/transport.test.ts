import { describe, expect, test } from "bun:test";

import { EMPTY_TRANSPORT, capacityKgText, changedTransport, parseCapacityKg } from "./transport";

describe("truck capacity", () => {
  test("kg typed becomes whole grams; blank is none; junk is invalid", () => {
    expect(parseCapacityKg("2000")).toBe(2_000_000);
    expect(parseCapacityKg("2,000.5")).toBe(2_000_500);
    expect(parseCapacityKg("  ")).toBeNull();
    expect(parseCapacityKg("0")).toBeUndefined();
    expect(parseCapacityKg("-5")).toBeUndefined();
    expect(parseCapacityKg("abc")).toBeUndefined();
    expect(parseCapacityKg("100001")).toBeUndefined();
    expect(parseCapacityKg("100000")).toBe(100_000_000);
  });

  test("grams back to the field", () => {
    expect(capacityKgText(9_000_000)).toBe("9000");
    expect(capacityKgText(2_000_500)).toBe("2000.5");
    expect(capacityKgText(null)).toBe("");
  });
});

describe("changedTransport: only what the person changed", () => {
  const before = { ...EMPTY_TRANSPORT, vehicleNo: "GJ05AB1234", transporterId: "t1", capacityKg: "9000" };

  test("nothing changed, nothing sent", () => {
    expect(changedTransport(before, { ...before }, { invoice: true })).toEqual({});
  });

  test("a changed transporter, vehicle and capacity", () => {
    expect(
      changedTransport(before, { ...before, transporterId: "t2", vehicleNo: "gj05 cd 9999", capacityKg: "2000" }, { invoice: false }),
    ).toEqual({ transporterId: "t2", vehicleNo: "gj05 cd 9999", vehicleCapacityG: 2_000_000 });
  });

  test("clearing sends null (no transporter, no capacity)", () => {
    expect(changedTransport(before, { ...before, transporterId: "", capacityKg: "", vehicleNo: "" }, { invoice: false })).toEqual({
      transporterId: null,
      vehicleNo: null,
      vehicleCapacityG: null,
    });
  });

  test("invoice fields go only to someone who may link invoices", () => {
    const after = { ...before, invoiceNumber: " INV-9 ", invoiceDate: "2026-10-24" };
    expect(changedTransport(before, after, { invoice: false })).toEqual({});
    expect(changedTransport(before, after, { invoice: true })).toEqual({ invoiceNumber: "INV-9", invoiceDate: "2026-10-24" });
  });

  test("a capacity that is not a number is left out", () => {
    expect(changedTransport(before, { ...before, capacityKg: "lots" }, { invoice: false })).toEqual({});
  });
});
