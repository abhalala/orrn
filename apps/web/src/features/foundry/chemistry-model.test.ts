import { describe, expect, test } from "bun:test";
import { CHARGE_CHEMISTRY_ELEMENTS } from "@orrn/domain";

import { chemistryDraft, chemistryPayload, setCount } from "./chemistry-model";

describe("typical chemistry drafts", () => {
  test("ppm shows as percent and comes back as the same ppm", () => {
    const draft = chemistryDraft({ si: 4_500, fe: 1_200, mg: null }, CHARGE_CHEMISTRY_ELEMENTS);
    expect(draft.si).toBe("0.450");
    expect(draft.mg).toBe("");
    expect(draft.cu).toBe("");
    const back = chemistryPayload(draft, CHARGE_CHEMISTRY_ELEMENTS);
    expect(back.ok && back.ppm.si).toBe(4_500);
    expect(back.ok && back.ppm.fe).toBe(1_200);
    expect(back.ok && back.ppm.mg).toBeNull();
  });
  test("a comma is a decimal point; a bad box is named; blank clears", () => {
    expect(chemistryPayload({ si: "0,45" }, ["si"])).toEqual({ ok: true, ppm: { si: 4_500 } });
    expect(chemistryPayload({ si: "0.45", fe: "abc" }, ["si", "fe"])).toEqual({ ok: false, element: "fe" });
    expect(chemistryPayload({ si: "101" }, ["si"])).toEqual({ ok: false, element: "si" });
    expect(chemistryPayload({}, ["si"])).toEqual({ ok: true, ppm: { si: null } });
  });
  test("counts the elements set", () => {
    expect([setCount({ si: 1, fe: null }), setCount(null)]).toEqual([1, 0]);
  });
});
