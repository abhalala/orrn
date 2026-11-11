import { describe, expect, test } from "bun:test";

import { detectDateFormat, excelSerialToIso, looksLikeDate, parseDate } from "./dates";
import { editDistance, matchName, nameKey, type NameEntry } from "./names";

describe("nameKey (same rule as server/lib/purchase.ts)", () => {
  test("NFKC, lower case, letters and digits only", () => {
    expect(nameKey("Shree  Ganesh Aluminium Pvt. Ltd.")).toBe("shreeganeshaluminiumpvtltd");
    expect(nameKey("ＡＢＣ-12")).toBe("abc12");
    // Same as the server: combining vowel signs are not letters, so they drop. Parity matters more than looks.
    expect(nameKey("श्री गणेश")).toBe("शरगणश");
    expect(nameKey("  ")).toBe("");
  });
});

describe("matchName", () => {
  const entries: NameEntry[] = [
    { id: "1", key: nameKey("Shree Ganesh Aluminium"), label: "Shree Ganesh Aluminium" },
    { id: "2", key: nameKey("Om Metals"), label: "Om Metals" },
    { id: "3", key: nameKey("Om Metal Works"), label: "Om Metal Works" },
  ];
  test("exact key", () => {
    expect(matchName("SHREE GANESH ALUMINIUM", entries)).toEqual({ kind: "exact", ids: ["1"] });
  });
  test("edit distance 2 or less is near, never exact", () => {
    const r = matchName("Om Metal", entries);
    expect(r.kind).toBe("near");
    if (r.kind === "near") expect(r.options[0]!.id).toBe("2");
    expect(matchName("Om Metlas", entries).kind).toBe("near");
  });
  test("a shared prefix of 6 characters is near", () => {
    expect(matchName("Shree Ganesh Industries", entries).kind).toBe("near");
  });
  test("distance 3 and a short shared prefix is none", () => {
    expect(matchName("Xyz Traders", entries)).toEqual({ kind: "none" });
    expect(editDistance("abcdef", "abcxyz", 2)).toBe(3);
  });
  test("two entries with one key both come back", () => {
    const dup = [...entries, { id: "9", key: nameKey("Om Metals"), label: "OM METALS" }];
    expect(matchName("om metals", dup)).toEqual({ kind: "exact", ids: ["2", "9"] });
  });
  test("a blank name matches nothing", () => {
    expect(matchName("  -- ", entries)).toEqual({ kind: "none" });
  });
});

describe("parseDate", () => {
  const o = { currentYear: 2026 };
  test("formats and separators", () => {
    expect(parseDate("31/10/2025", "dmy", o)).toBe("2025-10-31");
    expect(parseDate("31.10.25", "dmy", o)).toBe("2025-10-31");
    expect(parseDate("31 10 2025", "dmy", o)).toBe("2025-10-31");
    expect(parseDate("10/31/2025", "mdy", o)).toBe("2025-10-31");
    expect(parseDate("2025-10-31", "ymd", o)).toBe("2025-10-31");
    expect(parseDate("2025/10/31", "dmy", o)).toBe("2025-10-31");
    expect(parseDate("31-Oct-25", "d_mon_y", o)).toBe("2025-10-31");
    expect(parseDate("31 October 2025", "d_mon_y", o)).toBe("2025-10-31");
    expect(parseDate("Oct 31, 2025", "d_mon_y", o)).toBe("2025-10-31");
    expect(parseDate("2025-10-31T10:15:00", "ymd", o)).toBe("2025-10-31");
  });
  test("excel serial", () => {
    expect(parseDate("45961", "excel_serial", o)).toBe("2025-10-31");
    expect(excelSerialToIso(45961.75)).toBe("2025-10-31");
    expect(parseDate("abc", "excel_serial", o)).toBeNull();
    expect(parseDate("0", "excel_serial", o)).toBeNull();
  });
  test("invalid days and months are refused", () => {
    expect(parseDate("31/04/2025", "dmy", o)).toBeNull();
    expect(parseDate("29/02/2025", "dmy", o)).toBeNull();
    expect(parseDate("29/02/2024", "dmy", o)).toBe("2024-02-29");
    expect(parseDate("13/13/2025", "dmy", o)).toBeNull();
    expect(parseDate("", "dmy", o)).toBeNull();
  });
  test("two-digit years", () => {
    expect(parseDate("01/01/27", "dmy", o)).toBe("2027-01-01");
    expect(parseDate("01/01/28", "dmy", o)).toBe("1928-01-01");
  });
  test("looksLikeDate", () => {
    expect(looksLikeDate("12 Oct 2025")).toBe(true);
    expect(looksLikeDate("R2105")).toBe(false);
    expect(looksLikeDate("45961")).toBe(false);
  });
});

describe("detectDateFormat", () => {
  test("a value with a first part above 12 settles day first", () => {
    expect(detectDateFormat(["31/10/2025", "01/11/2025"])).toMatchObject({ format: "dmy", ambiguous: false });
  });
  test("a value with a second part above 12 settles month first", () => {
    expect(detectDateFormat(["10/31/2025", "11/01/2025"])).toMatchObject({ format: "mdy", ambiguous: false });
  });
  test("every value fitting both is an ambiguity, not a guess", () => {
    expect(detectDateFormat(["01/02/2025", "03/04/2025"])).toMatchObject({ format: null, ambiguous: true });
  });
  test("ISO and month names are not ambiguous", () => {
    expect(detectDateFormat(["2025-10-31", "2025-11-01"])).toMatchObject({ format: "ymd", ambiguous: false });
    expect(detectDateFormat(["31-Oct-25", "01-Nov-25"])).toMatchObject({ format: "d_mon_y", ambiguous: false });
  });
  test("no dates", () => {
    expect(detectDateFormat(["", "  "])).toMatchObject({ format: null, ambiguous: false });
  });
});
