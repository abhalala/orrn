import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { addressLines, cadenceDays, cityOf, companyTimeZone, customerFactsLine, lastDispatchPhrase, periodRange, todayIn, ymdToDate } from "../features/customers/customer-view";
import { dieCode, dieMeasurements, geometryText, kgText, measurementText } from "../features/dies/die-display";
import { guidesFor } from "../features/guides/guides";
import { inviteAcceptOutcome, inviteProbeResult, isExistingAccount } from "../features/invite/invite-flow";
import { moreRows } from "../features/more/more-rows";
import { isNotFound } from "../features/more/query-errors";
import { sortMembers } from "../features/settings/team";
import { DEFAULT_THEME_PREF, isThemePref, pickThemePref } from "../lib/theme-pref";

type MeArg = Parameters<typeof moreRows>[0];
const me = (modules: string[]): MeArg => ({ company: { id: "c", name: "F", slug: "f", status: "active", plan: null, role: "manager", modules } }) as never;

describe("More rows and modules", () => {
  test("an empty module list means every module is on", () => {
    expect(moreRows(me([])).map((r) => r.key)).toEqual(["dies", "customers", "guides", "settings"]);
  });

  test("a company with only the customers module loses Dies (Pack is not bought)", () => {
    expect(moreRows(me(["customers"])).map((r) => r.key)).toEqual(["customers", "guides", "settings"]);
  });

  test("module names are case blind", () => {
    expect(moreRows(me(["Dies", "CUSTOMERS"])).map((r) => r.key)).toEqual(["dies", "customers", "guides", "settings"]);
  });

  test("no company: only the rows that need none", () => {
    expect(moreRows(null).map((r) => r.key)).toEqual(["dies", "customers", "guides", "settings"]);
  });
});

describe("Guides by role", () => {
  test("admin sees every guide, die room sees its own", () => {
    expect(guidesFor("en", "admin")).toHaveLength(10);
    const dieRoom = guidesFor("en", "die_room").map((g) => g.slug);
    expect(dieRoom).not.toContain("pack-session");
    expect(dieRoom.length).toBeGreaterThan(0);
  });

  test("no role shows the whole book rather than an empty page", () => {
    expect(guidesFor("hi", undefined)).toHaveLength(10);
  });
});

describe("Invite", () => {
  test("a live link answers UNAUTHORIZED while signed out; dead links say so", () => {
    expect(inviteProbeResult({ data: { code: "UNAUTHORIZED" } })).toBe("valid");
    expect(inviteProbeResult({ data: { code: "NOT_FOUND" } })).toBe("expired");
    expect(inviteProbeResult({ data: { code: "BAD_REQUEST" } })).toBe("expired");
    expect(inviteProbeResult(new Error("Network request failed"))).toBe("failed");
  });

  test("an error without a code is not an existing account", () => {
    expect(isExistingAccount({ status: 422 })).toBe(false);
    expect(isExistingAccount(undefined)).toBe(false);
  });

  test("a timeout is a failed outcome, never an expired link", () => {
    expect(inviteAcceptOutcome({ data: null })).toBe("failed");
  });
});

describe("Dies", () => {
  test("code, kg and range read like the floor writes them", () => {
    expect(dieCode({ series: "PATTI", sectionCode: "14701" })).toBe("PATTI 14701");
    expect(kgText(2400)).toBe("2.4");
    expect(kgText(2650)).toBe("2.65");
    expect(kgText(2400.0000001)).toBe("2.4");
  });

  test("measurements show in the company unit", () => {
    const units = { mm: "mm", inch: "in" };
    expect(measurementText(3.2, "mm", units)).toBe("3.2 mm");
    expect(measurementText(25.4, "inch", units)).toBe("1 in");
    expect(geometryText(null, "mm")).toBe("");
  });

  test("measurements come in display order; old dies keep width and thickness in dimensions", () => {
    expect(dieMeasurements({ widthMm: 40, legMm: 2 }).map((m) => m.field)).toEqual(["width", "leg"]);
    expect(dieMeasurements({ dimensions: { widthMm: 30, thicknessMm: 3 } })).toEqual([
      { field: "width", mm: 30 },
      { field: "thickness", mm: 3 },
    ]);
    expect(dieMeasurements({})).toEqual([]);
  });
});

describe("Customers", () => {
  test("address lines: street, then city state PIN", () => {
    expect(addressLines({ line1: " 12 Ind. Area ", city: "Rajkot", state: "Gujarat", postalCode: 360003 })).toEqual(["12 Ind. Area", "Rajkot, Gujarat 360003"]);
    expect(addressLines(null)).toEqual([]);
    expect(addressLines({ country: "India" })).toEqual([]);
    expect(cityOf({ city: "Rajkot" })).toBe("Rajkot");
    expect(cityOf(null)).toBe("");
  });

  test("periods end today; the year starts on 1 April", () => {
    expect(periodRange("month", "2026-10-24")).toEqual({ from: "2026-10-01", to: "2026-10-24" });
    expect(periodRange("quarter", "2026-11-05")).toEqual({ from: "2026-10-01", to: "2026-11-05" });
    expect(periodRange("quarter", "2026-02-10")).toEqual({ from: "2026-01-01", to: "2026-02-10" });
    expect(periodRange("fy", "2026-10-24")).toEqual({ from: "2026-04-01", to: "2026-10-24" });
    expect(periodRange("fy", "2026-02-10")).toEqual({ from: "2025-04-01", to: "2026-02-10" });
  });

  test("the company calendar day, with an unknown zone falling back to IST", () => {
    const late = new Date("2026-10-24T20:00:00Z");
    expect(todayIn("Asia/Kolkata", late)).toBe("2026-10-25");
    expect(todayIn("Not/AZone", late)).toBe("2026-10-25");
    expect(companyTimeZone({ timezone: "Asia/Dubai" })).toBe("Asia/Dubai");
    expect(companyTimeZone({})).toBe("Asia/Kolkata");
  });

  test("a calendar day becomes the same local day", () => {
    const d = ymdToDate("2026-04-01");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 3, 1]);
  });

  test("facts line: last dispatch, then cadence once there is one", () => {
    const { t } = createI18n("en");
    expect(lastDispatchPhrase(null).key).toBe("customers.detail.lastNever");
    expect(lastDispatchPhrase(0).key).toBe("customers.detail.lastToday");
    expect(lastDispatchPhrase(1).key).toBe("customers.detail.lastYesterday");
    expect(cadenceDays(0.2)).toBe(1);
    expect(cadenceDays(null)).toBeNull();
    expect(customerFactsLine(t, { daysSinceLast: null, cadenceDays: 9 })).toBe("No dispatches yet");
    expect(customerFactsLine(t, { daysSinceLast: 12, cadenceDays: 9 })).toBe("Last dispatch 12 days ago, every ~9 days");
    expect(customerFactsLine(t, { daysSinceLast: 1, cadenceDays: null })).toBe("Last dispatch yesterday");
  });

  test("not found is the tRPC NOT_FOUND code only", () => {
    expect(isNotFound({ data: { code: "NOT_FOUND" } })).toBe(true);
    expect(isNotFound({ data: { code: "FORBIDDEN" } })).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});

describe("Settings", () => {
  test("team reads owner first, then by role, then by name", () => {
    const m = (role: string, name: string) => ({ role, user: { id: name, name, email: `${name}@x.in` } });
    const sorted = sortMembers([m("packer", "Zed"), m("viewer", "Amit"), m("owner", "Raj"), m("packer", "Asha"), m("mystery", "Q")]);
    expect(sorted.map((x) => x.user.name)).toEqual(["Raj", "Asha", "Zed", "Amit", "Q"]);
  });

  test("a saved colour choice wins; anything else follows the device", () => {
    expect(DEFAULT_THEME_PREF).toBe("system");
    expect(pickThemePref("dark")).toBe("dark");
    expect(pickThemePref("light")).toBe("light");
    expect(pickThemePref("sepia")).toBe("system");
    expect(pickThemePref(null)).toBe("system");
    expect(isThemePref("system")).toBe(true);
  });
});
