import { describe, expect, test } from "bun:test";

import {
  bandRangeText,
  bandTitle,
  formatBand,
  bpText,
  gramsToWholeKg,
  parseGrams,
  parseWholeKgToGrams,
  shortDate,
  bytesText,
  cardTabParam,
  dieFileKind,
  conflictExisting,
  copyCodeQuery,
  kgGroupedText,
  lifeText,
  milliKgText,
  parseKgToMilli,
  parseRank,
  parseWallTenths,
  pctTenthText,
  refusalText,
  statusTone,
  toneToChip,
  wallMmText,
} from "./die-room-model";

describe("formatting server numbers", () => {
  test("kg per 12 ft is always three decimals", () => {
    expect(milliKgText(5_967)).toBe("5.967");
    expect(milliKgText(6_200)).toBe("6.200");
    expect(milliKgText(12_180)).toBe("12.180");
  });

  test("a band is one string: kg per 12 ft, three decimals, an en dash", () => {
    expect(bandRangeText(5_900, 6_200)).toBe("5.900–6.200");
    expect(bandRangeText(6_200, 6_600)).toBe("6.200–6.600");
  });

  test("formatBand is THE band format: x.xxx\u2013y.yyy kg/12ft, always three decimals", () => {
    expect(formatBand(5_900, 6_200, "kg/12ft")).toBe("5.900\u20136.200 kg/12ft");
    // The board used to print "2-2.2", "2.8-3" and "3-3.2" (qa_die-room #6).
    expect(formatBand(2_000, 2_200, "kg/12ft")).toBe("2.000\u20132.200 kg/12ft");
    expect(formatBand(2_800, 3_000, "kg/12ft")).toBe("2.800\u20133.000 kg/12ft");
    expect(formatBand(3_000, 3_200, "kg/12ft")).toBe("3.000\u20133.200 kg/12ft");
    expect(formatBand(12_180, 12_500, "kg/12ft")).toBe("12.180\u201312.500 kg/12ft");
  });

  test("a band title adds the wall and leaves it out when the section has none written", () => {
    expect(bandTitle({ wallTenthMm: 12, weightMinG: 5_900, weightMaxG: 6_200 }, "mm", "kg/12ft")).toBe("1.2 mm \u00b7 5.900\u20136.200 kg/12ft");
    expect(bandTitle({ wallTenthMm: 0, weightMinG: 2_700, weightMaxG: 2_900 }, "mm", "kg/12ft")).toBe("2.700\u20132.900 kg/12ft");
  });

  test("percent comes from tenths with a sign", () => {
    expect(pctTenthText(11)).toBe("+1.1%");
    expect(pctTenthText(98)).toBe("+9.8%");
    expect(pctTenthText(33)).toBe("+3.3%");
    expect(pctTenthText(0)).toBe("0.0%");
    expect(pctTenthText(-4)).toBe("-0.4%");
    expect(pctTenthText(-15)).toBe("-1.5%");
  });

  test("wall in mm from tenths", () => {
    expect(wallMmText(12)).toBe("1.2");
    expect(wallMmText(30)).toBe("3.0");
  });

  test("kg grouping and file sizes", () => {
    expect(kgGroupedText(8_000_000)).toBe("8,000");
    expect(kgGroupedText(1_234_500)).toBe("1,234.5");
    expect(bytesText(8 * 1024 * 1024)).toBe("8.4 MB");
    expect(bytesText(2_048)).toBe("2 KB");
    expect(bytesText(12)).toBe("12 B");
  });

  test("life reads produced of life, none when unset", () => {
    expect(lifeText(1_200_000, 8_000_000)).toEqual({ produced: "1,200", life: "8,000" });
    expect(lifeText(0, null)).toBeNull();
  });
});

describe("parsing what a person types", () => {
  test("a weight in kg becomes grams, three decimals at most", () => {
    expect(parseKgToMilli("5.967")).toBe(5_967);
    expect(parseKgToMilli("6")).toBe(6_000);
    expect(parseKgToMilli("6.2")).toBe(6_200);
    expect(parseKgToMilli("12.180")).toBe(12_180);
    expect(parseKgToMilli("501")).toBeNull();
    expect(parseKgToMilli("500")).toBe(500_000);
    expect(parseKgToMilli("5.9671")).toBeNull();
    expect(parseKgToMilli("")).toBeNull();
    expect(parseKgToMilli("0")).toBeNull();
    expect(parseKgToMilli("abc")).toBeNull();
    expect(parseKgToMilli("-3")).toBeNull();
  });

  test("a wall in mm becomes tenths, one decimal at most", () => {
    expect(parseWallTenths("1.2")).toBe(12);
    expect(parseWallTenths("3")).toBe(30);
    expect(parseWallTenths("1.25")).toBeNull();
    expect(parseWallTenths("0")).toBeNull();
    expect(parseWallTenths("")).toBeNull();
  });

  test("a tier rank is a whole number from 1", () => {
    expect(parseRank("2")).toBe(2);
    expect(parseRank("0")).toBeNull();
    expect(parseRank("1.5")).toBeNull();
    expect(parseRank("")).toBeNull();
  });

  test("a slash in a copy code is a hyphen", () => {
    expect(copyCodeQuery(" 12170/2 ")).toBe("12170-2");
    expect(copyCodeQuery("12170-2")).toBe("12170-2");
  });
});

describe("tones and tabs", () => {
  test("drift tones map to chip tones; under band is blue, none is neutral", () => {
    expect(toneToChip("green")).toBe("green");
    expect(toneToChip("amber")).toBe("amber");
    expect(toneToChip("red")).toBe("red");
    expect(toneToChip("under")).toBe("blue");
    expect(toneToChip("none")).toBe("neutral");
  });

  test("status tones", () => {
    expect(statusTone("available")).toBe("green");
    expect(statusTone("in_use")).toBe("blue");
    expect(statusTone("at_maker")).toBe("amber");
    expect(statusTone("retired")).toBe("neutral");
  });

  test("an unknown tab falls back to readings", () => {
    expect(cardTabParam("maker")).toBe("maker");
    expect(cardTabParam("files")).toBe("files");
    expect(cardTabParam("nope")).toBe("readings");
    expect(cardTabParam(undefined)).toBe("readings");
    expect(cardTabParam(3)).toBe("readings");
  });
});

describe("server refusals", () => {
  const words = { forbidden: "Your role can't do this.", generic: "Something went wrong." };

  test("a conflict names the band that already exists", () => {
    const error = {
      message: "12170 already has a band",
      data: { code: "CONFLICT", meta: { existing: { sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200, wallTenthMm: 12, bandId: "primary" } } },
    };
    expect(conflictExisting(error)).toEqual({ sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200, wallTenthMm: 12, bandId: "primary" });
    expect(conflictExisting({ data: { code: "CONFLICT" } })).toBeNull();
    expect(conflictExisting(null)).toBeNull();
  });

  test("the server's plain sentences pass through; role refusals and surprises use shared wording", () => {
    expect(refusalText({ message: "12170-2 is retired; it takes no readings", data: { code: "BAD_REQUEST" } }, words)).toBe("12170-2 is retired; it takes no readings");
    expect(refusalText({ message: "You don't have permission to do that", data: { code: "FORBIDDEN" } }, words)).toBe(words.forbidden);
    expect(refusalText({ message: "This die belongs to KD Extrusion", data: { code: "FORBIDDEN" } }, words)).toBe("This die belongs to KD Extrusion");
    expect(refusalText({ message: "[{\"code\":\"too_small\"}]", data: { code: "BAD_REQUEST" } }, words)).toBe(words.generic);
    expect(refusalText({ message: "boom", data: { code: "INTERNAL_SERVER_ERROR" } }, words)).toBe(words.generic);
    expect(refusalText(new Error("x"), words)).toBe(words.generic);
  });
});

describe("life and nitriding inputs", () => {
  test("life is typed in whole kg and stored in grams", () => {
    expect(parseWholeKgToGrams("8000")).toBe(8_000_000);
    expect(parseWholeKgToGrams("8,000")).toBe(8_000_000);
    expect(parseWholeKgToGrams("0")).toBeNull();
    expect(parseWholeKgToGrams("1.5")).toBeNull();
    expect(gramsToWholeKg(8_000_000)).toBe("8000");
    expect(gramsToWholeKg(null)).toBe("");
  });

  test("nitriding chemicals are whole grams", () => {
    expect(parseGrams("500")).toBe(500);
    expect(parseGrams("0")).toBe(0);
    expect(parseGrams("1.5")).toBeNull();
    expect(parseGrams("")).toBeNull();
  });

  test("dates read in the plant's day, recovery in percent", () => {
    expect(shortDate("2026-10-24T10:00:00.000Z")).toBe("24 Oct 2026");
    expect(shortDate(null)).toBe("");
    expect(shortDate("not a date")).toBe("");
    expect(bpText(7550)).toBe("75.5%");
    expect(bpText(null)).toBe("");
  });
});

describe("die files", () => {
  test("a picked file is an image, a PDF, a CDR or a DWG; anything else is refused", () => {
    expect(dieFileKind({ name: "tee.jpg", type: "image/jpeg" })).toBe("image");
    expect(dieFileKind({ name: "draw.PDF", type: "" })).toBe("pdf");
    expect(dieFileKind({ name: "a.cdr", type: "application/octet-stream" })).toBe("cdr");
    expect(dieFileKind({ name: "a.dwg", type: "" })).toBe("dwg");
    expect(dieFileKind({ name: "a.xlsx", type: "application/vnd.ms-excel" })).toBeNull();
  });
});
