import { describe, expect, test } from "bun:test";

import { COMPANY_ROLES } from "@orrn/i18n";

import { invitableRoles, isExpired, lengthUnitOf, timezoneOf, timezoneOptions, validEmail } from "./model";

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
