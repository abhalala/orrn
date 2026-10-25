import { describe, expect, test } from "bun:test";

import { partyNoLabel, partyRange } from "./party";

describe("party numbers after save", () => {
  test("first to last of the customer's own numbers", () => {
    expect(
      partyRange([
        { serial: "26J4086", partyNo: "26J12" },
        { serial: "26J4087", partyNo: "26J13" },
        { serial: "26J4088", partyNo: "26J14" },
      ]),
    ).toEqual({ from: "26J12", to: "26J14" });
  });

  test("a company without party series has none to show", () => {
    expect(partyRange([{ serial: "26J4086", partyNo: "26J4086" }])).toBeNull();
    expect(partyRange([{ serial: "26J4086", partyNo: null }])).toBeNull();
  });

  test("beside a serial a party number shows only when it differs", () => {
    expect(partyNoLabel({ serial: "26J4086", partyNo: "26J12" })).toBe("26J12");
    expect(partyNoLabel({ serial: "26J4086", partyNo: "26J4086" })).toBeNull();
    expect(partyNoLabel({ serial: "26J4086", partyNo: null })).toBeNull();
  });
});
