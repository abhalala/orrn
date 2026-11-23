import { describe, expect, test } from "bun:test";

import { blankReceive, mtcFileOk, receiveInput, sizeParts } from "./logs-model";

const TODAY = "2026-11-22";
const good = { ...blankReceive(TODAY), vendorId: "v1", alloyId: "a1", pcs: "40", kg: "1250.5" };

describe("receive form", () => {
  test("a minimal form is accepted, empty optionals are left out", () => {
    expect(receiveInput(good, TODAY)).toEqual({ ok: true, input: { vendorId: "v1", alloyId: "a1", receivedOn: TODAY, pcs: 40, kgG: 1_250_500 } });
  });
  test("full form carries sizes and references trimmed", () => {
    const r = receiveInput({ ...good, diameterMm: "127", lengthMm: "5000", vendorCastNo: " C-77 ", challanNo: " 912 ", note: " ok " }, TODAY);
    expect(r).toEqual({
      ok: true,
      input: { vendorId: "v1", alloyId: "a1", receivedOn: TODAY, pcs: 40, kgG: 1_250_500, diameterMm: 127, lengthMm: 5000, vendorCastNo: "C-77", challanNo: "912", note: "ok" },
    });
  });
  test("required fields in screen order", () => {
    expect(receiveInput({ ...good, vendorId: "" }, TODAY)).toEqual({ ok: false, field: "vendor" });
    expect(receiveInput({ ...good, alloyId: "" }, TODAY)).toEqual({ ok: false, field: "alloy" });
    expect(receiveInput({ ...good, pcs: "" }, TODAY)).toEqual({ ok: false, field: "pcs" });
    expect(receiveInput({ ...good, pcs: "0" }, TODAY)).toEqual({ ok: false, field: "pcs" });
    expect(receiveInput({ ...good, pcs: "2.5" }, TODAY)).toEqual({ ok: false, field: "pcs" });
    expect(receiveInput({ ...good, kg: "" }, TODAY)).toEqual({ ok: false, field: "kg" });
    expect(receiveInput({ ...good, kg: "0" }, TODAY)).toEqual({ ok: false, field: "kg" });
    expect(receiveInput({ ...good, kg: "200000" }, TODAY)).toEqual({ ok: false, field: "kg" });
  });
  test("a future or malformed day is refused", () => {
    expect(receiveInput({ ...good, receivedOn: "2026-11-23" }, TODAY)).toEqual({ ok: false, field: "future" });
    expect(receiveInput({ ...good, receivedOn: "" }, TODAY)).toEqual({ ok: false, field: "day" });
    expect(receiveInput({ ...good, receivedOn: TODAY }, TODAY).ok).toBe(true);
    expect(receiveInput({ ...good, receivedOn: "2026-01-01" }, TODAY).ok).toBe(true);
  });
  test("size ranges follow the server", () => {
    expect(receiveInput({ ...good, diameterMm: "19" }, TODAY)).toEqual({ ok: false, field: "diameter" });
    expect(receiveInput({ ...good, diameterMm: "1001" }, TODAY)).toEqual({ ok: false, field: "diameter" });
    expect(receiveInput({ ...good, diameterMm: "20" }, TODAY).ok).toBe(true);
    expect(receiveInput({ ...good, lengthMm: "99" }, TODAY)).toEqual({ ok: false, field: "length" });
    expect(receiveInput({ ...good, lengthMm: "10001" }, TODAY)).toEqual({ ok: false, field: "length" });
    expect(receiveInput({ ...good, lengthMm: "10000" }, TODAY).ok).toBe(true);
  });
});

describe("helpers", () => {
  test("size parts", () => {
    expect(sizeParts({ diameterMm: 127, lengthMm: 5000 })).toBe("both");
    expect(sizeParts({ diameterMm: 127, lengthMm: null })).toBe("diameter");
    expect(sizeParts({ diameterMm: null, lengthMm: 5000 })).toBe("length");
    expect(sizeParts({ diameterMm: null, lengthMm: null })).toBe("none");
  });
  test("MTC file names", () => {
    expect(mtcFileOk("mtc.PDF")).toBe(true);
    expect(mtcFileOk("scan.jpg")).toBe(true);
    expect(mtcFileOk("sheet.xlsx")).toBe(false);
  });
});
