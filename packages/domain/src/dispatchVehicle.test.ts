import { describe, expect, test } from "bun:test";

import { normaliseVehicleNo, vehicleGate } from "./dispatchVehicle";

describe("BACKLOG 62: no dispatch leaves without a vehicle number", () => {
  test("a header that has one goes straight on", () => {
    expect(vehicleGate("GJ05AB1234", "")).toEqual({ kind: "ready" });
  });
  test("none in the header and none typed: refused before anything is sent", () => {
    expect(vehicleGate(null, "")).toEqual({ kind: "missing" });
    expect(vehicleGate("  ", " - ")).toEqual({ kind: "missing" });
  });
  test("typed in the sheet: normalised like the server and saved first", () => {
    expect(vehicleGate(null, " gj 05-ab 1234")).toEqual({ kind: "save", vehicleNo: "GJ05AB1234" });
    expect(normaliseVehicleNo("mh-12 x 9")).toBe("MH12X9");
  });
  test("not letters and digits: asked again", () => {
    expect(vehicleGate(undefined, "GJ/05")).toEqual({ kind: "invalid" });
    expect(vehicleGate(undefined, "A")).toEqual({ kind: "invalid" });
  });
});
