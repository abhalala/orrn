import { describe, expect, test } from "bun:test";

import { addressLines, addressToDraft, draftToAddress, EMPTY_ADDRESS, gstinField, normalizeGstin, isValidGstin, sameDraft } from "./address";

const KD = {
  line1: "Plot 41, GIDC Industrial Estate",
  line2: "Vatva",
  city: "Ahmedabad",
  state: "Gujarat",
  postalCode: "382445",
  country: "India",
};

describe("addressToDraft", () => {
  test("reads the stored address shape into text fields", () => {
    expect(addressToDraft(KD)).toEqual({
      line1: "Plot 41, GIDC Industrial Estate",
      line2: "Vatva",
      city: "Ahmedabad",
      state: "Gujarat",
      postalCode: "382445",
    });
  });

  test("missing or odd values become empty text", () => {
    expect(addressToDraft(null)).toEqual(EMPTY_ADDRESS);
    expect(addressToDraft({ city: { name: "x" }, postalCode: 382445 })).toEqual({ ...EMPTY_ADDRESS, postalCode: "382445" });
  });
});

describe("draftToAddress", () => {
  test("trims, keeps keys the form doesn't edit (country) and drops emptied ones", () => {
    const out = draftToAddress({ ...addressToDraft(KD), line2: "  ", city: " Ahmedabad " }, KD);
    expect(out).toEqual({
      line1: "Plot 41, GIDC Industrial Estate",
      city: "Ahmedabad",
      state: "Gujarat",
      postalCode: "382445",
      country: "India",
    });
  });

  test("an all-empty draft clears the address", () => {
    expect(draftToAddress(EMPTY_ADDRESS, null)).toBeNull();
    // Only a key the form doesn't show is left: still no address to print.
    expect(draftToAddress(EMPTY_ADDRESS, KD)).toBeNull();
  });
});

describe("sameDraft", () => {
  test("compares trimmed text", () => {
    expect(sameDraft(addressToDraft(KD), { ...addressToDraft(KD), city: "Ahmedabad " })).toBe(true);
    expect(sameDraft(addressToDraft(KD), { ...addressToDraft(KD), city: "Rajkot" })).toBe(false);
  });
});

describe("addressLines", () => {
  test("street lines, then city, state and PIN on one line", () => {
    expect(addressLines(KD)).toEqual(["Plot 41, GIDC Industrial Estate", "Vatva", "Ahmedabad, Gujarat 382445"]);
    expect(addressLines({ line1: "B-18, Ghogha Circle Market", line2: "", city: "Bhavnagar", state: "Gujarat", postalCode: "" })).toEqual([
      "B-18, Ghogha Circle Market",
      "Bhavnagar, Gujarat",
    ]);
    expect(addressLines(null)).toEqual([]);
  });
});

describe("GSTIN", () => {
  test("is 15 letters and digits, stored upper case without spaces", () => {
    expect(normalizeGstin(" 24aabck4471m1z6 ")).toBe("24AABCK4471M1Z6");
    expect(isValidGstin("24AABCK4471M1Z6")).toBe(true);
    expect(isValidGstin("24AABCK4471M1Z")).toBe(false);
    expect(isValidGstin("24AABCK4471M1Z6X")).toBe(false);
    expect(isValidGstin("24AABCK-471M1Z6")).toBe(false);
  });
});

describe("gstinField (what the form saves and says about the GSTIN)", () => {
  test("a new or changed GSTIN must be 15 letters and numbers", () => {
    expect(gstinField("24aabck4471m1z6", null)).toEqual({ value: "24AABCK4471M1Z6" });
    expect(gstinField("24 AABCK 4471M1Z6", null)).toEqual({ value: "24AABCK4471M1Z6" });
    expect(gstinField("24AABCK", null)).toEqual({ value: null, error: "customers.form.gstinInvalid" });
    expect(gstinField("24AABCK", "24AABCK4471M1Z6")).toEqual({ value: null, error: "customers.form.gstinInvalid" });
  });

  test("an empty field clears it", () => {
    expect(gstinField("  ", "24AABCK4471M1Z6")).toEqual({ value: null });
    expect(gstinField("", null)).toEqual({ value: null });
  });

  test("an untouched legacy GSTIN never blocks a save: it is kept exactly and flagged", () => {
    // Imported partial GSTINs (T25 ruling) must not stop someone fixing only the phone.
    expect(gstinField("24AABCK", "24AABCK")).toEqual({ value: "24AABCK", warning: "customers.form.gstinLegacy" });
    expect(gstinField(" 24aabck4471m1z6 ", " 24aabck4471m1z6 ")).toEqual({ value: " 24aabck4471m1z6 " });
  });
});
