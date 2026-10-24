import { describe, expect, test } from "bun:test";

import { COMPANY_ROLES } from "@orrn/i18n";

import {
  buildNumberOf,
  deviceGate,
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
  shiftDraftErrors,
  shiftsDirty,
  shiftsPayload,
  standardBlank,
  standardsDraft,
  standardsPatch,
  supportContactOf,
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

  test("a device is Blocked below the platform's minimum build; revoked wins; web has no gate", () => {
    const min = (p: string) => (p === "android" ? 10 : 1);
    expect(buildNumberOf("1.1 (11)")).toBe(11);
    expect(buildNumberOf("1.1")).toBeNull();
    expect(deviceGate({ platform: "android", appVersion: "1.0 (9)", revokedAt: null }, min)).toBe("blocked");
    expect(deviceGate({ platform: "android", appVersion: "1.1 (10)", revokedAt: null }, min)).toBe("current");
    expect(deviceGate({ platform: "android", appVersion: "1.0 (9)", revokedAt: "2026-10-01" }, min)).toBe("revoked");
    expect(deviceGate({ platform: "web", appVersion: null, revokedAt: null }, min)).toBe("web");
    expect(deviceGate({ platform: "ios", appVersion: null, revokedAt: null }, min)).toBe("current");
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
