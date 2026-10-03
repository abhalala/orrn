import { describe, expect, test } from "bun:test";

import { formatAgo, formatDay, formatTime } from "./format";
import {
  companyStatusTone,
  grantState,
  grantTone,
  printingTone,
  suggestStationName,
  validateStationName,
} from "./status";
import { accessTabPath, impersonationEndsSoon } from "./impersonate";

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

  test("ends soon inside the last five minutes", () => {
    expect(impersonationEndsSoon(new Date(NOW.getTime() + 4 * 60_000).toISOString(), NOW)).toBe(true);
    expect(impersonationEndsSoon(new Date(NOW.getTime() + 20 * 60_000).toISOString(), NOW)).toBe(false);
  });
});
