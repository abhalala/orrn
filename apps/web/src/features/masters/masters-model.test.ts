import { describe, expect, test } from "bun:test";

import type { Me } from "@orrn/server/lib/permissions";
import type { CompanyRole } from "@orrn/server/lib/permissions";

import {
  bpToPercentInput,
  dieCopyStatusView,
  holdsSummary,
  gradeCodeProblem,
  kgPer12ftInput,
  locationCodeProblem,
  masterEntries,
  masterErrorKey,
  mergeSearchSeed,
  parseKgPer12ftMilli,
  parsePercentBp,
  parseWholeNumber,
  percentText,
  streamCodeProblem,
  vendorStatusView,
  gstinProblem,
  spellingsFromText,
  formatDay,
  rupeesPerKg,
} from "./masters-model";

function me(role: CompanyRole): Me {
  return {
    user: { id: "u1", name: "U", email: "u@orrn.local" },
    company: { id: "c1", name: "Co", slug: "co", status: "active", plan: null, role, modules: [] },
    isPlatformAdmin: false,
    platformRole: null,
  } as unknown as Me;
}

describe("percent fields (basis points on the wire)", () => {
  test("bp shows as the number a person typed", () => {
    expect(bpToPercentInput(8850)).toBe("88.5");
    expect(bpToPercentInput(9000)).toBe("90");
    expect(bpToPercentInput(1)).toBe("0.01");
    expect(bpToPercentInput(null)).toBe("");
  });

  test("percent text for lists", () => {
    expect(percentText(8850)).toBe("88.5%");
    expect(percentText(10_000)).toBe("100%");
    expect(percentText(null)).toBeNull();
  });

  test("parses 0 to 100 with at most two decimals; blank means none", () => {
    expect(parsePercentBp("88.5")).toEqual({ ok: true, value: 8850 });
    expect(parsePercentBp(" 100 ")).toEqual({ ok: true, value: 10_000 });
    expect(parsePercentBp("0.25")).toEqual({ ok: true, value: 25 });
    expect(parsePercentBp("")).toEqual({ ok: true, value: null });
    expect(parsePercentBp("100.5").ok).toBe(false);
    expect(parsePercentBp("88.555").ok).toBe(false);
    expect(parsePercentBp("abc").ok).toBe(false);
    expect(parsePercentBp("-3").ok).toBe(false);
  });
});

describe("kg/12ft fields (thousandths of a kg on the wire)", () => {
  test("shows three decimals at most, no trailing zeros", () => {
    expect(kgPer12ftInput(1842)).toBe("1.842");
    expect(kgPer12ftInput(2500)).toBe("2.5");
    expect(kgPer12ftInput(null)).toBe("");
  });

  test("parses a positive kg/12ft up to 500 with three decimals", () => {
    expect(parseKgPer12ftMilli("1.842")).toEqual({ ok: true, value: 1842 });
    expect(parseKgPer12ftMilli("2.5")).toEqual({ ok: true, value: 2500 });
    expect(parseKgPer12ftMilli("")).toEqual({ ok: true, value: null });
    expect(parseKgPer12ftMilli("0").ok).toBe(false);
    expect(parseKgPer12ftMilli("1.8425").ok).toBe(false);
    expect(parseKgPer12ftMilli("501").ok).toBe(false);
  });
});

describe("whole numbers", () => {
  test("in range, blank allowed", () => {
    expect(parseWholeNumber("3", { min: 1, max: 99 })).toEqual({ ok: true, value: 3 });
    expect(parseWholeNumber("", { min: 1, max: 99 })).toEqual({ ok: true, value: null });
    expect(parseWholeNumber("1,200", { min: 0, max: 5000 })).toEqual({ ok: true, value: 1200 });
    expect(parseWholeNumber("0", { min: 1, max: 99 }).ok).toBe(false);
    expect(parseWholeNumber("100", { min: 1, max: 99 }).ok).toBe(false);
    expect(parseWholeNumber("2.5", { min: 1, max: 99 }).ok).toBe(false);
  });
});

describe("mergeSearchSeed", () => {
  test("starts the duplicate search from the most telling word of the name", () => {
    expect(mergeSearchSeed("Shree Ganesh Metals")).toBe("Ganesh");
    expect(mergeSearchSeed("K.D. Traders")).toBe("Traders");
    expect(mergeSearchSeed("Gulf Alloys LLC")).toBe("Alloys");
    expect(mergeSearchSeed("AB")).toBe("AB");
  });

  test("skips the words every second vendor has", () => {
    expect(mergeSearchSeed("Mahavir Metal Corporation")).toBe("Mahavir");
    expect(mergeSearchSeed("Shree Ambe Enterprises")).toBe("Ambe");
  });
});

describe("holdsSummary (stock.byLocation totals)", () => {
  test("adds bundles, kg of the kg kinds and store items", () => {
    expect(
      holdsSummary([
        { itemKind: "bundle", itemCount: 12, qtyG: 1_240_500 },
        { itemKind: "scrap_grade", itemCount: 3, qtyG: 18_940_000 },
        { itemKind: "store_item", itemCount: 4, qtyG: null },
      ]),
    ).toEqual({ bundles: 12, kgG: 20_180_500, storeItems: 4, empty: false });
    expect(holdsSummary([])).toEqual({ bundles: 0, kgG: 0, storeItems: 0, empty: true });
  });
});

describe("status views (colour is never the only signal)", () => {
  test("vendor", () => {
    expect(vendorStatusView("active")).toEqual({ tone: null, key: "vendors.status.active" });
    expect(vendorStatusView("draft")).toEqual({ tone: "amber", key: "vendors.status.draft" });
    expect(vendorStatusView("archived")).toEqual({ tone: "neutral", key: "vendors.status.archived" });
    expect(vendorStatusView("merged")).toEqual({ tone: "neutral", key: "vendors.status.merged" });
  });

  test("die copy follows the status colours (green ready, blue in use, amber away, neutral retired)", () => {
    expect(dieCopyStatusView("available")).toEqual({ tone: "green", key: "masters.dieCopies.status.available" });
    expect(dieCopyStatusView("in_use")).toEqual({ tone: "blue", key: "masters.dieCopies.status.in_use" });
    expect(dieCopyStatusView("at_nitriding")).toEqual({ tone: "amber", key: "masters.dieCopies.status.at_nitriding" });
    expect(dieCopyStatusView("at_maker")).toEqual({ tone: "amber", key: "masters.dieCopies.status.at_maker" });
    expect(dieCopyStatusView("on_trial")).toEqual({ tone: "amber", key: "masters.dieCopies.status.on_trial" });
    expect(dieCopyStatusView("retired")).toEqual({ tone: "neutral", key: "masters.dieCopies.status.retired" });
  });
});

describe("masterErrorKey (server words to the person's language)", () => {
  const err = (message: string, code = "CONFLICT") => Object.assign(new Error(message), { data: { code } });

  test("names already used", () => {
    expect(masterErrorKey(err("That name is already used by Shree Ganesh Metals"))).toEqual({
      key: "vendors.errors.nameTaken",
      vars: { name: "Shree Ganesh Metals" },
    });
    expect(masterErrorKey(err("That name is already used by another vendor"))).toEqual({
      key: "vendors.errors.nameTakenOther",
    });
    expect(masterErrorKey(err("That spelling already belongs to another vendor"))).toEqual({
      key: "vendors.errors.spellingTaken",
    });
    expect(masterErrorKey(err("Location Y7 already exists"))).toEqual({
      key: "masters.locations.errors.codeTaken",
      vars: { code: "Y7" },
    });
    expect(masterErrorKey(err("That scrap item already exists"))).toEqual({ key: "masters.scrap.errors.itemTaken" });
    expect(masterErrorKey(err("That grade already exists"))).toEqual({ key: "masters.scrap.errors.gradeTaken" });
    expect(masterErrorKey(err("A return stream with that code or name exists"))).toEqual({
      key: "masters.streams.errors.taken",
    });
  });

  test("a location that still holds stock", () => {
    expect(
      masterErrorKey(
        err("Location Y2 still holds stock; move it out before retiring the location", "BAD_REQUEST"),
      ),
    ).toEqual({ key: "masters.locations.errors.notEmpty", vars: { code: "Y2" } });
  });

  test("merge rules", () => {
    expect(masterErrorKey(err("Confirm this vendor before merging others into it", "BAD_REQUEST"))).toEqual({
      key: "vendors.errors.confirmKeeperFirst",
    });
    expect(masterErrorKey(err("One of these vendors was already merged", "BAD_REQUEST"))).toEqual({
      key: "vendors.errors.alreadyMerged",
    });
    expect(masterErrorKey(err("Keep a live vendor", "BAD_REQUEST"))).toEqual({ key: "vendors.errors.keepLive" });
  });

  test("races, permissions, archived sections, anything else", () => {
    expect(masterErrorKey(err("The vendors changed; try again"))).toEqual({ key: "masters.errors.changed" });
    expect(masterErrorKey(err("The section changed; try again"))).toEqual({ key: "masters.errors.changed" });
    expect(masterErrorKey(err("This section is archived; no new die copies", "BAD_REQUEST"))).toEqual({
      key: "masters.dieCopies.errors.sectionArchived",
    });
    expect(masterErrorKey(err("You do not have permission", "FORBIDDEN"))).toEqual({ key: "masters.errors.forbidden" });
    expect(masterErrorKey(err("Failed to fetch", "INTERNAL_SERVER_ERROR"))).toEqual({ key: "masters.errors.generic" });
    expect(masterErrorKey(new Error("boom"))).toEqual({ key: "masters.errors.generic" });
    expect(masterErrorKey(null)).toEqual({ key: "masters.errors.generic" });
  });
});

describe("masterEntries (the Masters page)", () => {
  const keys = (role: CompanyRole) => masterEntries(me(role)).map((e) => e.key);

  test("owner and manager see every master", () => {
    for (const role of ["owner", "manager", "admin"] as const) {
      expect(keys(role)).toEqual(["vendors", "scrap", "storeItems", "locations", "sections", "dieCopies", "reasons", "furnaces", "alloys"]);
    }
  });

  test("furnaces and alloys only for the people who publish masters", () => {
    expect(keys("supervisor")).not.toContain("furnaces");
    expect(keys("foundry")).not.toContain("alloys");
  });

  test("vendors only for purchase readers, store items only for the store's people", () => {
    expect(keys("office")).toEqual(["vendors", "scrap", "locations", "sections", "dieCopies", "reasons"]);
    expect(keys("storekeeper")).toEqual(["vendors", "scrap", "storeItems", "locations", "sections", "dieCopies", "reasons"]);
    expect(keys("packer")).toEqual(["scrap", "locations", "sections", "dieCopies", "reasons"]);
  });

  test("every entry belongs to a group and points at a real path", () => {
    for (const e of masterEntries(me("owner"))) {
      expect(["buying", "floor"]).toContain(e.group);
      expect(e.to.startsWith("/")).toBe(true);
    }
  });
});

describe("code rules (same as the server's)", () => {
  test("location codes: letters, digits, dashes; never 0", () => {
    expect(locationCodeProblem("y7")).toBeNull();
    expect(locationCodeProblem("PLANT-SCRAP")).toBeNull();
    expect(locationCodeProblem(" ")).toBe("required");
    expect(locationCodeProblem("000")).toBe("zero");
    expect(locationCodeProblem("-Y1")).toBe("invalid");
    expect(locationCodeProblem("Y 1")).toBe("invalid");
    expect(locationCodeProblem("A".repeat(21))).toBe("invalid");
  });

  test("grade codes: up to 8 of letters, digits, + and -", () => {
    expect(gradeCodeProblem("a+")).toBeNull();
    expect(gradeCodeProblem("")).toBe("required");
    expect(gradeCodeProblem("A++++++++")).toBe("invalid");
    expect(gradeCodeProblem("A B")).toBe("invalid");
  });

  test("stream codes: up to 20 letters, digits and dashes", () => {
    expect(streamCodeProblem("dross-ingot")).toBeNull();
    expect(streamCodeProblem("")).toBe("required");
    expect(streamCodeProblem("PLANT SCRAP")).toBe("invalid");
    expect(streamCodeProblem("X".repeat(21))).toBe("invalid");
  });

  test("GSTIN: blank is fine (unregistered), otherwise the 15-character pattern", () => {
    expect(gstinProblem("")).toBeNull();
    expect(gstinProblem("24abcde1234f1z5")).toBeNull();
    expect(gstinProblem("24ABCDE1234F1Z")).toBe("invalid");
    expect(gstinProblem("ABCDE1234F1Z5XX")).toBe("invalid");
  });

  test("spellings: one per line, trimmed, blanks and repeats dropped", () => {
    expect(spellingsFromText(" KD Traders\n\nK.D. Traders \nkd traders\nKD Trdrs")).toEqual([
      "KD Traders",
      "KD Trdrs",
    ]);
    expect(spellingsFromText("")).toEqual([]);
  });
});

describe("formatDay and rupeesPerKg", () => {
  test("a book date: year only when it is not this year", () => {
    expect(formatDay("2026-10-04", "2026-10-04")).toBe("4 Oct");
    expect(formatDay("2025-12-31", "2026-01-02")).toBe("31 Dec 2025");
    expect(formatDay("not a date", "2026-10-04")).toBe("not a date");
  });

  test("rate in paise to rupees with two decimals, en-IN grouping", () => {
    expect(rupeesPerKg(19_850)).toBe("198.50");
    expect(rupeesPerKg(1_23_456_00)).toBe("1,23,456.00");
  });
});
