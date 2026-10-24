import { describe, expect, test } from "bun:test";

import { DEFAULT_TIMEZONE, timezoneOptions } from "./timezones";

const NOW = new Date("2026-10-03T06:30:00Z");

describe("timezoneOptions", () => {
  test("India first, then the short list, each with its offset", () => {
    const opts = timezoneOptions({ now: NOW });
    expect(DEFAULT_TIMEZONE).toBe("Asia/Kolkata");
    expect(opts[0]).toEqual({ value: "Asia/Kolkata", label: "Asia/Kolkata, GMT+5:30", device: false });
    expect(opts.map((o) => o.value)).toContain("UTC");
    expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length);
  });

  test("the device's zone and an already saved zone are added once when missing", () => {
    const opts = timezoneOptions({ now: NOW, device: "America/Chicago", saved: "Africa/Nairobi" });
    const values = opts.map((o) => o.value);
    expect(values.filter((v) => v === "America/Chicago").length).toBe(1);
    expect(values.filter((v) => v === "Africa/Nairobi").length).toBe(1);
    expect(opts.find((o) => o.value === "America/Chicago")!.device).toBe(true);
  });

  test("the device flag marks a listed zone instead of duplicating it", () => {
    const opts = timezoneOptions({ now: NOW, device: "Asia/Kolkata" });
    expect(opts.filter((o) => o.value === "Asia/Kolkata")).toEqual([
      { value: "Asia/Kolkata", label: "Asia/Kolkata, GMT+5:30", device: true },
    ]);
  });

  test("a zone the browser doesn't know is dropped, not shown broken", () => {
    const opts = timezoneOptions({ now: NOW, device: "Mars/Olympus", saved: "Not/AZone" });
    expect(opts.map((o) => o.value)).not.toContain("Mars/Olympus");
    expect(opts.map((o) => o.value)).not.toContain("Not/AZone");
  });
});
