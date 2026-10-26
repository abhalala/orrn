import { describe, expect, test } from "bun:test";

import { packLineChoices } from "./pack-lines";

describe("wave-2 M9: booking orders at Pack", () => {
  test("oldest first from the server, but bookings go last and are never the suggestion", () => {
    const out = packLineChoices([
      { lineId: "so3", orderStatus: "booking" },
      { lineId: "so1", orderStatus: "confirmed" },
      { lineId: "so4", orderStatus: "booking" },
      { lineId: "so5", orderStatus: "dispatching" },
    ]);
    expect(out.map((c) => [c.line.lineId, c.suggested, c.booking])).toEqual([
      ["so1", true, false],
      ["so5", false, false],
      ["so3", false, true],
      ["so4", false, true],
    ]);
  });

  test("only bookings: offered, marked, nothing suggested", () => {
    const out = packLineChoices([{ lineId: "so3", orderStatus: "booking" }]);
    expect(out).toEqual([{ line: { lineId: "so3", orderStatus: "booking" }, suggested: false, booking: true }]);
    expect(packLineChoices([])).toEqual([]);
  });
});
