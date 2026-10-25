import { describe, expect, test } from "bun:test";

import { readReject } from "./reject-form";

describe("reject reasons on the pack screen (W4-MASTERS review I-3)", () => {
  // The picker lists the plant's active qc_reject codes from the server (press.reasons), so a code the
  // plant added in Masters is there and a retired one is not. The note rule follows the picked code.
  test("other needs a note by default; a code the plant set to need a note needs one too", () => {
    expect(readReject({ pcs: "2", kg: "", reasonCode: "other", note: " " })).toMatchObject({ ok: false, errors: { note: "note" } });
    expect(readReject({ pcs: "2", kg: "", reasonCode: "die_line", note: "" })).toEqual({ ok: true, reject: { pcs: 2, reasonCode: "die_line" } });
    expect(readReject({ pcs: "2", kg: "", reasonCode: "die_line", note: "" }, true)).toMatchObject({ ok: false, errors: { note: "note" } });
    expect(readReject({ pcs: "2", kg: "", reasonCode: "die_line", note: "end" }, true)).toEqual({ ok: true, reject: { pcs: 2, reasonCode: "die_line", note: "end" } });
  });

  test("no reason picked is refused (the note is not asked before a reason)", () => {
    expect(readReject({ pcs: "2", kg: "", reasonCode: "", note: "" }, true)).toEqual({ ok: false, errors: { reason: "reason" } });
  });
});
