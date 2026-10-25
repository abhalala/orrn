import { describe, expect, test } from "bun:test";

import { COMPANY_ROLES } from "@orrn/i18n";

import {
  bpToPercentText,
  draftFromShifts,
  gstinValid,
  invitableRoles,
  isExpired,
  lengthUnitOf,
  letterheadDirty,
  letterheadDraft,
  minuteToTime,
  moduleStates,
  newShiftDraft,
  percentTextToBp,
  shiftDraftErrors,
  shiftsDirty,
  shiftsPayload,
  standardBlank,
  standardsDraft,
  standardsPatch,
  supportContactOf,
  supportDraft,
  supportPatch,
  thresholdsDraft,
  thresholdsErrors,
  thresholdsPatch,
  timeToMinute,
  timezoneOf,
  timezoneOptions,
  validEmail,
} from "./model";

describe("settings model", () => {
  test("length unit defaults to mm; only inch switches", () => {
    expect(lengthUnitOf(undefined)).toBe("mm");
    expect(lengthUnitOf({ lengthUnit: "inch" })).toBe("inch");
    expect(lengthUnitOf({ lengthUnit: "feet" })).toBe("mm");
  });

  test("timezone falls back to Asia/Kolkata", () => {
    expect(timezoneOf({})).toBe("Asia/Kolkata");
    expect(timezoneOf({ timezone: "UTC" })).toBe("UTC");
    expect(timezoneOf({ timezone: "" })).toBe("Asia/Kolkata");
  });

  test("timezone options always hold the current zone and the default, sorted, no duplicates", () => {
    const list = timezoneOptions("Pacific/Fiji", ["UTC", "Asia/Kolkata", "Europe/London"]);
    expect(list).toEqual(["Asia/Kolkata", "Europe/London", "Pacific/Fiji", "UTC"]);
    expect(timezoneOptions("UTC", []).includes("UTC")).toBe(true);
  });

  test("only an owner can invite an owner", () => {
    expect(invitableRoles("admin", COMPANY_ROLES)).not.toContain("owner");
    expect(invitableRoles("owner", COMPANY_ROLES)).toContain("owner");
    expect(invitableRoles("admin", COMPANY_ROLES)).toContain("viewer");
  });

  test("invite expiry and email checks", () => {
    expect(isExpired(1000, 2000)).toBe(true);
    expect(isExpired(3000, 2000)).toBe(false);
    expect(validEmail(" a@b.in ")).toBe(true);
    expect(validEmail("a@b")).toBe(false);
    expect(validEmail("")).toBe(false);
  });
});

describe("shifts form", () => {
  const saved = [
    { id: "a", name: "Day", seq: 1, startMin: 480, endMin: 1200 },
    { id: "b", name: "Night", seq: 2, startMin: 1200, endMin: 480 },
  ];

  test("minutes and HH:MM convert both ways; junk is null", () => {
    expect(minuteToTime(480)).toBe("08:00");
    expect(minuteToTime(0)).toBe("00:00");
    expect(timeToMinute("08:00")).toBe(480);
    expect(timeToMinute("23:59")).toBe(1439);
    expect(timeToMinute("24:00")).toBeNull();
    expect(timeToMinute("")).toBeNull();
    expect(timeToMinute("8")).toBeNull();
  });

  test("a saved list round-trips through the form and is not dirty; a time change is", () => {
    const draft = draftFromShifts(saved);
    expect(draft.map((r) => r.name)).toEqual(["Day", "Night"]);
    expect(shiftsPayload(draft)).toEqual([
      { id: "a", name: "Day", seq: 1, startMin: 480, endMin: 1200 },
      { id: "b", name: "Night", seq: 2, startMin: 1200, endMin: 480 },
    ]);
    expect(shiftsDirty(draft, saved)).toBe(false);
    expect(shiftsDirty(draft.map((r) => (r.id === "b" ? { ...r, start: "07:00" } : r)), saved)).toBe(true);
  });

  test("the valid Day and Night pair has no errors; Night starting at 07:00 overlaps Day", () => {
    const draft = draftFromShifts(saved);
    expect(shiftDraftErrors(draft)).toEqual([]);
    const overlap = draft.map((r) => (r.name === "Night" ? { ...r, start: "07:00" } : r));
    expect(shiftDraftErrors(overlap)).toContain("gap_or_overlap");
  });

  test("new rows have no id, take their order as seq, and a blank name or time is an error", () => {
    const draft = [...draftFromShifts(saved), newShiftDraft({ name: "", start: "", end: "" })];
    const payload = shiftsPayload(draft);
    expect(payload[2]).toMatchObject({ seq: 3, name: "" });
    expect("id" in payload[2]!).toBe(false);
    const errors = shiftDraftErrors(draft);
    expect(errors).toContain("name_empty");
    expect(errors).toContain("minute_range");
  });

  test("five shifts is one too many; duplicate names are caught ignoring case", () => {
    const rows = Array.from({ length: 5 }, (_, i) => newShiftDraft({ name: `S${i}`, start: "00:00", end: "00:00" }));
    expect(shiftDraftErrors(rows)).toContain("count");
    const dup = [
      newShiftDraft({ name: "Day", start: "08:00", end: "20:00" }),
      newShiftDraft({ name: "day", start: "20:00", end: "08:00" }),
    ];
    expect(shiftDraftErrors(dup)).toContain("name_duplicate");
  });
});

describe("standards form", () => {
  test("a draft fills missing kinds with blanks and a patch carries only what changed, trimmed", () => {
    const saved = standardsDraft({ solid: { standard: "IS 733", cml: "" } });
    expect(saved.hollow).toEqual({ standard: "", cml: "" });
    const next = { ...saved, hollow: { standard: " IS 1285 ", cml: "CM/L 1234" } };
    expect(standardsPatch(next, saved)).toEqual({ hollow: { standard: "IS 1285", cml: "CM/L 1234" } });
    expect(standardsPatch(saved, saved)).toEqual({});
  });

  test("clearing a kind sends two blanks, which the server reads as clear", () => {
    const saved = standardsDraft({ semi: { standard: "IS 733", cml: "X" } });
    expect(standardsPatch({ ...saved, semi: { standard: "", cml: "" } }, saved)).toEqual({ semi: { standard: "", cml: "" } });
    expect(standardBlank({ standard: " ", cml: "" })).toBe(true);
  });
});

describe("modules, letterhead, devices, support contact", () => {
  test("an empty module list means every module is on; a list turns the rest off", () => {
    expect(moduleStates([]).every((m) => m.on)).toBe(true);
    expect(moduleStates(undefined).every((m) => m.on)).toBe(true);
    const some = moduleStates(["dies", "Bundles"]);
    expect(some.find((m) => m.id === "dies")?.on).toBe(true);
    expect(some.find((m) => m.id === "bundles")?.on).toBe(true);
    expect(some.find((m) => m.id === "press")?.on).toBe(false);
  });

  test("GSTIN is blank or 15 letters and digits in either case", () => {
    expect(gstinValid("")).toBe(true);
    expect(gstinValid("24abcde1234f1z5")).toBe(true);
    expect(gstinValid("24ABCDE1234F1Z")).toBe(false);
    expect(gstinValid("24ABCDE1234F1Z5!")).toBe(false);
  });

  test("the letterhead draft reads nulls as blanks and dirty ignores outer spaces", () => {
    const a = letterheadDraft({ legalName: null, gstin: "24ABCDE1234F1Z5" });
    expect(a).toEqual({ legalName: "", gstin: "24ABCDE1234F1Z5", address: "", phone: "" });
    expect(letterheadDirty(a, { ...a, phone: "  " })).toBe(false);
    expect(letterheadDirty(a, { ...a, phone: "98250 00000" })).toBe(true);
  });

  test("the support form starts from the stored contact and sends only the fields that changed (blank clears)", () => {
    const saved = supportDraft({ support: { name: "Asha", phone: "98250 11111", hours: "9 to 6", email: "a@plant.test" } });
    expect(saved).toEqual({ name: "Asha", phone: "98250 11111", hours: "9 to 6" });
    expect(supportDraft(undefined)).toEqual({ name: "", phone: "", hours: "" });
    expect(supportPatch(saved, saved)).toBeNull();
    expect(supportPatch({ ...saved, phone: " 98250 22222 " }, saved)).toEqual({ phone: "98250 22222" });
    expect(supportPatch({ ...saved, hours: "  " }, saved)).toEqual({ hours: "" });
  });

  test("the support contact is read from settings.support and ignored when empty or wrong", () => {
    expect(supportContactOf(undefined)).toBeNull();
    expect(supportContactOf({ support: "x" })).toBeNull();
    expect(supportContactOf({ support: { hours: "9 to 6" } })).toBeNull();
    expect(supportContactOf({ support: { name: " Asha ", phone: "98250 11111", hours: "9 to 6" } })).toEqual({
      name: "Asha",
      phone: "98250 11111",
      email: null,
      hours: "9 to 6",
    });
  });
});

describe("thresholds form (rank 31)", () => {
  const saved = { drift: { greenMaxBp: 800, amberMaxBp: 1000 }, recoveryBands: null, press: { balanceWarnBp: 200 } };

  test("basis points and typed percent convert both ways; comma, two decimals, 0 to 100 only", () => {
    expect(bpToPercentText(800)).toBe("8");
    expect(bpToPercentText(1250)).toBe("12.5");
    expect(bpToPercentText(0)).toBe("0");
    expect(bpToPercentText(10_000)).toBe("100");
    expect(percentTextToBp("8")).toBe(800);
    expect(percentTextToBp(" 12,5 ")).toBe(1250);
    expect(percentTextToBp("0.05")).toBe(5);
    expect(percentTextToBp("100")).toBe(10_000);
    for (const bad of ["", "abc", "100.5", "101", "-1", "1.234", "8%"]) expect(percentTextToBp(bad)).toBeNull();
  });

  test("the defaults round-trip and are not dirty (the specs 800/1000 bp, 2 % balance)", () => {
    const draft = thresholdsDraft(saved);
    expect(draft).toEqual({ driftGreen: "8", driftAmber: "10", recoveryGreen: "", recoveryAmber: "", balanceWarn: "2" });
    expect(thresholdsErrors(draft)).toEqual({});
    expect(thresholdsPatch(draft, saved)).toEqual({});
  });

  test("green at or above amber is refused on the amber field; recovery amber at or above green too", () => {
    const base = thresholdsDraft(saved);
    expect(thresholdsErrors({ ...base, driftGreen: "10" })).toEqual({ driftAmber: "driftOrder" });
    expect(thresholdsErrors({ ...base, driftGreen: "12" })).toEqual({ driftAmber: "driftOrder" });
    expect(thresholdsErrors({ ...base, recoveryGreen: "70", recoveryAmber: "75" })).toEqual({ recoveryAmber: "recoveryOrder" });
    expect(thresholdsErrors({ ...base, recoveryGreen: "80", recoveryAmber: "" })).toEqual({ recoveryAmber: "recoveryBoth" });
    expect(thresholdsErrors({ ...base, recoveryGreen: "", recoveryAmber: "70" })).toEqual({ recoveryGreen: "recoveryBoth" });
    expect(thresholdsErrors({ ...base, driftAmber: "101" })).toEqual({ driftAmber: "number" });
    expect(thresholdsErrors({ ...base, balanceWarn: "x" })).toEqual({ balanceWarn: "number" });
  });

  test("the patch has only what changed, in basis points; blank recovery clears stored bands", () => {
    const base = thresholdsDraft(saved);
    expect(thresholdsPatch({ ...base, driftGreen: "7" }, saved)).toEqual({ driftGreenMaxBp: 700, driftAmberMaxBp: 1000 });
    expect(thresholdsPatch({ ...base, recoveryGreen: "80", recoveryAmber: "70" }, saved)).toEqual({ recoveryBands: { greenMinBp: 8000, amberMinBp: 7000 } });
    expect(thresholdsPatch({ ...base, balanceWarn: "3.5" }, saved)).toEqual({ pressBalanceWarnBp: 350 });
    const withBands = { ...saved, recoveryBands: { greenMinBp: 8000, amberMinBp: 7000 } };
    expect(thresholdsPatch({ ...thresholdsDraft(withBands), recoveryGreen: "", recoveryAmber: "" }, withBands)).toEqual({ recoveryBands: null });
    expect(thresholdsPatch(thresholdsDraft(withBands), withBands)).toEqual({});
  });
});

describe("cast book start (FP-FD-02)", () => {
  test("months run from this one for a year, and keep a stored one outside", async () => {
    const { castBookMonths } = await import("./model");
    const list = castBookMonths("2026-10-25");
    expect(list).toHaveLength(13);
    expect(list[0]).toBe("2026-10");
    expect(list[3]).toBe("2027-01");
    expect(list.at(-1)).toBe("2027-10");
    expect(castBookMonths("2026-10-25", "2026-08")[0]).toBe("2026-08");
    expect(castBookMonths("2026-10-25", "2026-12")).toHaveLength(13);
    expect(castBookMonths("nope", null)).toEqual([]);
  });
  test("the number is a whole number 1 to 99999", async () => {
    const { castBookStart } = await import("./model");
    expect(castBookStart(" 120 ")).toBe(120);
    expect(castBookStart("0")).toBeNull();
    expect(castBookStart("100000")).toBeNull();
    expect(castBookStart("12.5")).toBeNull();
    expect(castBookStart("")).toBeNull();
  });
});
