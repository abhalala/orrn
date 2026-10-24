import { describe, expect, test } from "bun:test";

import { en, hi } from "@orrn/i18n";

import { guidesFor } from "../features/guides/guides";
import { inviteAcceptOutcome, isExistingAccount } from "../features/invite/invite-flow";
import { moreRows } from "../features/more/more-rows";
import { greetingKey, inStock, showStartHere, todayTiles } from "../features/today/today-model";
import { formatDay, formatTime, monthNames } from "../lib/format";
import { popEntering, riseEntering } from "../lib/motion";
import { PL_SHARE_TARGETS, plFileName } from "../lib/packing-list-share";

type MeArg = Parameters<typeof todayTiles>[0];
const me = (role: string, modules: string[] = []): MeArg =>
  ({
    user: { id: "u", name: "Asha", email: "a@x.in" },
    company: { id: "c", name: "Fourcubes", slug: "fc", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
  }) as never;

describe("Today", () => {
  test("greeting follows the clock", () => {
    expect(greetingKey(6)).toBe("today.greetingMorning");
    expect(greetingKey(12)).toBe("today.greetingAfternoon");
    expect(greetingKey(17)).toBe("today.greetingEvening");
  });

  test("in stock is available plus held", () => {
    const zero = { bundles: 0, weightG: 0 };
    expect(
      inStock({ available: { bundles: 3, weightG: 150_000 }, reserved: { bundles: 1, weightG: 50_000 }, dispatched: zero, void: zero }),
    ).toEqual({ bundles: 4, kg: 200 });
  });

  test("action tiles only for people who pack or work a dispatch; viewers see numbers only (ruling T19)", () => {
    expect(todayTiles(me("packer"))).toEqual(["pack", "stock", "guides"]);
    expect(todayTiles(me("manager"))).toEqual(["pack", "dispatch", "stock", "guides"]);
    expect(todayTiles(me("viewer"))).toEqual([]);
    expect(todayTiles(me("accountant"))).toEqual([]);
  });

  test("company modules hide tiles too", () => {
    expect(todayTiles(me("manager", ["bundles"]))).toEqual(["pack", "stock", "guides"]);
  });

  test("Start here shows only before the first bundle exists (void included)", () => {
    const zero = { bundles: 0, weightG: 0 };
    const empty = { available: zero, reserved: zero, dispatched: zero, void: zero };
    expect(showStartHere(empty)).toBe(true);
    expect(showStartHere({ ...empty, void: { bundles: 1, weightG: 1 } })).toBe(false);
  });
});

describe("More rows (spec §4: Dies, Customers, Guides, Settings)", () => {
  test("every company member sees Dies, Customers, Guides and Settings when the modules allow", () => {
    expect(moreRows(me("packer")).map((r) => r.key)).toEqual(["dies", "customers", "guides", "settings"]);
  });

  test("module-limited companies lose the rows they did not buy", () => {
    expect(moreRows(me("manager", ["bundles"])).map((r) => r.key)).toEqual(["dies", "guides", "settings"]);
  });

  test("rows navigate inside the More stack", () => {
    expect(moreRows(me("owner")).map((r) => r.href)).toEqual(["/more/dies", "/more/customers", "/more/guides", "/more/settings"]);
  });
});

describe("Guides", () => {
  test("a role sees its own guides; owners and admins see every guide", () => {
    const packer = guidesFor("en", "packer").map((g) => g.slug);
    expect(packer).toContain("pack-session");
    expect(packer).not.toContain("invite-member");
    expect(guidesFor("en", "owner")).toHaveLength(10);
  });

  test("Hindi guides come back in Hindi", () => {
    const [first] = guidesFor("hi", "owner");
    expect(first!.title).not.toBe(guidesFor("en", "owner")[0]!.title);
  });
});

describe("Invite (audit N4)", () => {
  test("Better Auth's existing-account codes, old and new", () => {
    expect(isExistingAccount({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toBe(true);
    expect(isExistingAccount({ code: "USER_ALREADY_EXISTS" })).toBe(true);
    expect(isExistingAccount({ code: "INVALID_EMAIL" })).toBe(false);
    expect(isExistingAccount(null)).toBe(false);
  });

  test("accept errors: dead link, wrong account, signed out, anything else", () => {
    expect(inviteAcceptOutcome({ data: { code: "NOT_FOUND" } })).toBe("expired");
    expect(inviteAcceptOutcome({ data: { code: "BAD_REQUEST" } })).toBe("expired");
    expect(inviteAcceptOutcome({ data: { code: "FORBIDDEN" } })).toBe("wrongEmail");
    expect(inviteAcceptOutcome({ data: { code: "UNAUTHORIZED" } })).toBe("signedOut");
    expect(inviteAcceptOutcome(new Error("Network request failed"))).toBe("failed");
  });
});

describe("dates on the phone's clock", () => {
  const now = new Date(2026, 9, 6, 10, 0);
  test("d MMM this year, d MMM yyyy otherwise, months from i18n", () => {
    const months = monthNames(en.native.monthsShort);
    expect(formatDay(new Date(2026, 9, 4, 23, 0), months, now)).toBe("4 Oct");
    expect(formatDay(new Date(2025, 11, 30), months, now)).toBe("30 Dec 2025");
    expect(formatDay(null, months, now)).toBeNull();
  });

  test("Hindi month names keep Latin digits", () => {
    const months = monthNames(hi.native.monthsShort);
    expect(months).toHaveLength(12);
    expect(formatDay(new Date(2026, 9, 4), months, now)).toMatch(/^4 \S+$/);
  });

  test("24 h time", () => {
    expect(formatTime(new Date(2026, 9, 6, 7, 5))).toBe("07:05");
    expect(formatTime(new Date(2026, 9, 6, 19, 45))).toBe("19:45");
  });
});

describe("packing list share (correct file types, plan T29)", () => {
  test("PDF and Excel carry their MIME type and iOS UTI", () => {
    expect(PL_SHARE_TARGETS.pdf).toEqual({ mimeType: "application/pdf", UTI: "com.adobe.pdf", extension: "pdf" });
    expect(PL_SHARE_TARGETS.xlsx).toEqual({
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      UTI: "org.openxmlformats.spreadsheetml.sheet",
      extension: "xlsx",
    });
  });

  test("file names are safe and named after the dispatch", () => {
    expect(plFileName("D-0007", "xlsx")).toBe("packing-list-D-0007.xlsx");
    expect(plFileName("D/0007 x", "pdf")).toBe("packing-list-D-0007-x.pdf");
  });
});

describe("motion (pop and rise, none under reduced motion)", () => {
  test("reduced motion: no entering animation at all", () => {
    expect(popEntering(true)).toBeUndefined();
    expect(riseEntering(true, 2)).toBeUndefined();
  });

  test("otherwise animations exist and rise is staggered", () => {
    expect(popEntering(false)).toBeDefined();
    expect(riseEntering(false, 0)).toBeDefined();
  });
});
