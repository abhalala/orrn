import { describe, expect, test } from "bun:test";

import { DEFAULT_REASON_CODES } from "@orrn/domain";

import { REJECT_CODES } from "./rejects-panel";

describe("reject reason codes on the pack screen", () => {
  // The panel spells the codes out (the domain table must not ride in the `/` page's chunk), so the
  // list is checked against the seeded `qc_reject` reasons here.
  test("match the seeded qc_reject reasons, in order", () => {
    expect([...REJECT_CODES]).toEqual(DEFAULT_REASON_CODES.qc_reject.map((r) => r.code));
  });
});
