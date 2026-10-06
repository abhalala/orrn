import { describe, expect, test } from "bun:test";

import { formatAgo, formatDay, formatTime } from "./format";
import {
  companyAction,
  companyStatusTone,
  freeStationName,
  grantEndsAt,
  inactiveReason,
  grantState,
  grantTone,
  printingTone,
  suggestStationName,
  validateStationName,
} from "./status";
import { accessTabPath, afterStopFailure, impersonationEndsSoon } from "./impersonate";
import { initialPlan, modulesOn, modulesToSave, planForm } from "./plan";
import { showsLoadError } from "./query-state";

const NOW = new Date(2026, 9, 3, 15, 0, 0);

describe("formatDay", () => {
  test("day and short month this year, with the year otherwise", () => {
    expect(formatDay(new Date(2026, 9, 3, 9, 5), { now: NOW, locale: "en" })).toBe("3 Oct");
    expect(formatDay(new Date(2025, 11, 28), { now: NOW, locale: "en" })).toBe("28 Dec 2025");
  });

  test("accepts ISO strings and epoch numbers", () => {
    const d = new Date(2026, 0, 9, 10, 0);
    expect(formatDay(d.toISOString(), { now: NOW, locale: "en" })).toBe("9 Jan");
    expect(formatDay(d.getTime(), { now: NOW, locale: "en" })).toBe("9 Jan");
  });

  test("Hindi keeps Latin digits", () => {
    expect(formatDay(new Date(2026, 9, 3), { now: NOW, locale: "hi" })).toMatch(/^3 /);
  });
});

describe("formatTime", () => {
  test("24 hour clock", () => {
    expect(formatTime(new Date(2026, 9, 3, 14, 32), "en")).toBe("14:32");
    expect(formatTime(new Date(2026, 9, 3, 9, 5), "en")).toBe("09:05");
    expect(formatTime(new Date(2026, 9, 3, 9, 5), "hi")).toBe("09:05");
  });
});

describe("formatAgo", () => {
  test("relative within a month, a date after that", () => {
    expect(formatAgo(new Date(NOW.getTime() - 5 * 60_000), { now: NOW, locale: "en" })).toBe("5 minutes ago");
    expect(formatAgo(new Date(NOW.getTime() - 3 * 3_600_000), { now: NOW, locale: "en" })).toBe("3 hours ago");
    expect(formatAgo(new Date(NOW.getTime() - 26 * 3_600_000), { now: NOW, locale: "en" })).toBe("yesterday");
    expect(formatAgo(new Date(2026, 6, 1), { now: NOW, locale: "en" })).toBe("1 Jul");
  });

  test("under a minute reads as now", () => {
    expect(formatAgo(new Date(NOW.getTime() - 20_000), { now: NOW, locale: "en" })).toBe("now");
  });
});

describe("status tones", () => {
  test("company status: active green, waiting amber, suspended red", () => {
    expect(companyStatusTone("active")).toBe("green");
    expect(companyStatusTone("pending")).toBe("amber");
    expect(companyStatusTone("suspended")).toBe("red");
  });

  test("print station: connected green, waiting or offline amber, off red, none neutral", () => {
    expect(printingTone("active")).toBe("green");
    expect(printingTone("pending")).toBe("amber");
    expect(printingTone("offline")).toBe("amber");
    expect(printingTone("revoked")).toBe("red");
    expect(printingTone(null)).toBe("neutral");
  });
});

describe("company actions", () => {
  test("a company waiting for approval is reviewed through its request, never suspended or reactivated", () => {
    expect(companyAction("pending")).toBe("review");
    expect(companyAction("active")).toBe("suspend");
    expect(companyAction("suspended")).toBe("reactivate");
  });

  test("why a company cannot print or be opened: waiting for approval, or suspended", () => {
    expect(inactiveReason("pending")).toBe("waiting");
    expect(inactiveReason("suspended")).toBe("suspended");
    expect(inactiveReason("active")).toBeNull();
  });
});

describe("grantState", () => {
  const base = { expiresAt: new Date(NOW.getTime() + 10 * 60_000), revokedAt: null };
  test("active until it ends or is stopped", () => {
    expect(grantState(base, NOW)).toBe("active");
    expect(grantState({ ...base, expiresAt: new Date(NOW.getTime() - 1) }, NOW)).toBe("ended");
    expect(grantState({ ...base, revokedAt: new Date(NOW.getTime() - 60_000) }, NOW)).toBe("stopped");
  });

  test("a stopped grant reads as stopped even after its end time", () => {
    expect(
      grantState({ expiresAt: new Date(NOW.getTime() - 1), revokedAt: new Date(NOW.getTime() - 60_000).toISOString() }, NOW),
    ).toBe("stopped");
  });

  test("a stopped session ends when it was stopped, not at its planned end", () => {
    const stoppedAt = new Date(NOW.getTime() - 60_000);
    expect(grantEndsAt({ ...base, revokedAt: stoppedAt.toISOString() }).getTime()).toBe(stoppedAt.getTime());
    expect(grantEndsAt(base).getTime()).toBe(base.expiresAt.getTime());
  });

  test("tones: active blue (in progress), the rest neutral", () => {
    expect(grantTone("active")).toBe("blue");
    expect(grantTone("ended")).toBe("neutral");
    expect(grantTone("stopped")).toBe("neutral");
  });
});

describe("station name", () => {
  test("suggested from the company slug, cut to a valid label", () => {
    expect(suggestStationName("shree-ram-extrusions-1a2b3c4d")).toBe("shree-ram-extrusions");
    expect(suggestStationName("orrn-demo")).toBe("orrn-demo");
    expect(suggestStationName("Fourcubes Extrusions (Demo)")).toBe("fourcubes-extrusions-demo");
    expect(suggestStationName("ab")).toBe("ab-print");
    expect(suggestStationName("x".repeat(80)).length).toBeLessThanOrEqual(63);
  });

  test("a second station (or one after Turn off) gets a name no station has used yet", () => {
    expect(freeStationName("shree-ram-1a2b3c4d", [])).toBe("shree-ram");
    expect(freeStationName("shree-ram-1a2b3c4d", ["shree-ram"])).toBe("shree-ram-2");
    expect(freeStationName("shree-ram", ["shree-ram", "shree-ram-2", "other"])).toBe("shree-ram-3");
    const long = "x".repeat(80);
    const taken = [freeStationName(long, [])];
    const next = freeStationName(long, taken);
    expect(next).not.toBe(taken[0]);
    expect(validateStationName(next)).toBeNull();
  });

  test("validation returns the problem, or null", () => {
    expect(validateStationName("fourcubes")).toBeNull();
    expect(validateStationName("")).toBe("required");
    expect(validateStationName("ab")).toBe("length");
    expect(validateStationName("a".repeat(64))).toBe("length");
    expect(validateStationName("Four Cubes")).toBe("format");
    expect(validateStationName("-fourcubes")).toBe("format");
    expect(validateStationName("fourcubes-")).toBe("format");
  });
});

describe("impersonation", () => {
  test("stopping returns to that company's Access tab", () => {
    expect(accessTabPath("co_123")).toBe("/admin/companies/co_123?tab=access");
    expect(accessTabPath("a/b")).toBe("/admin/companies/a%2Fb?tab=access");
  });

  test("a failed Stop keeps the banner the first time unless the server says the grant is gone", () => {
    // No answer (network) or a server fault: the grant may still be live, so stay and offer a retry.
    expect(afterStopFailure(null, 1)).toBe("retry");
    expect(afterStopFailure("INTERNAL_SERVER_ERROR", 1)).toBe("retry");
    // A second failure leaves anyway (the grant still ends on its own; the Access tab can stop it).
    expect(afterStopFailure(null, 2)).toBe("leave");
    // The server answered that the grant is not this person's or does not exist: nothing to stop.
    expect(afterStopFailure("NOT_FOUND", 1)).toBe("leave");
    expect(afterStopFailure("FORBIDDEN", 1)).toBe("leave");
  });

  test("ends soon inside the last five minutes", () => {
    expect(impersonationEndsSoon(new Date(NOW.getTime() + 4 * 60_000).toISOString(), NOW)).toBe(true);
    expect(impersonationEndsSoon(new Date(NOW.getTime() + 20 * 60_000).toISOString(), NOW)).toBe(false);
  });
});

describe("plan form", () => {
  const ALL = ["customers", "dies", "bundles", "dispatches"] as const;

  test("a company with no plan yet starts on Starter and can be saved as is", () => {
    expect(planForm({ plan: null, modules: [] }, { plan: "starter", modules: [...ALL] })).toEqual({
      dirty: true,
      noPlanYet: true,
      noneOn: false,
    });
  });
  test("unchanged plan and modules (any order) are not dirty", () => {
    expect(planForm({ plan: "growth", modules: ["dies", "customers"] }, { plan: "growth", modules: ["customers", "dies"] })).toEqual({
      dirty: false,
      noPlanYet: false,
      noneOn: false,
    });
  });
  test("nothing saved means every module is on, so every box starts ticked", () => {
    expect(modulesOn([], ALL)).toEqual([...ALL]);
    expect(modulesOn(["dies", "bundles"], ALL)).toEqual(["dies", "bundles"]);
    expect(modulesOn(["payroll"], ALL)).toEqual([...ALL]);
  });
  test("every box ticked saves as all on (empty); unticking one keeps the rest on", () => {
    expect(modulesToSave([...ALL], ALL)).toEqual([]);
    expect(modulesToSave(["dispatches", "customers", "dies"], ALL)).toEqual(["customers", "dies", "dispatches"]);
  });
  test("no box ticked cannot be saved (it would mean every module on)", () => {
    expect(planForm({ plan: "growth", modules: ["dies"] }, { plan: "growth", modules: [] }).noneOn).toBe(true);
  });
  test("a changed plan or module is dirty", () => {
    expect(planForm({ plan: "growth", modules: [] }, { plan: "enterprise", modules: [] }).dirty).toBe(true);
    expect(planForm({ plan: "growth", modules: [] }, { plan: "growth", modules: ["dies"] }).dirty).toBe(true);
  });
  test("the starting plan is the saved one, Starter when none", () => {
    expect(initialPlan(null)).toBe("starter");
    expect(initialPlan("dev")).toBe("dev");
  });
});

describe("showsLoadError", () => {
  test("only a query with nothing to show gets the error panel", () => {
    expect(showsLoadError({ isError: true, data: undefined })).toBe(true);
    // A failed refetch keeps the last good data (React Query v5): keep showing it.
    expect(showsLoadError({ isError: true, data: { rows: [] } })).toBe(false);
    expect(showsLoadError({ isError: false, data: undefined })).toBe(false);
  });
});
