/** XE parity lane MAINT, row 68: the device reading placeholder (built, not live). Pure; no worker needed. */
import { describe, expect, test } from "bun:test";

import { DEVICE_CLOCK_SKEW_MS, deviceReadingRow } from "../src/lib/maintDevice";

const NOW = Date.UTC(2026, 10, 2, 6, 30);
const msg = { deviceId: "temp-1", assetCode: "PRESS-1", kindName: "Oil temperature", value: 72.5, readAt: NOW - 1000 };

describe("device reading placeholder (#68)", () => {
  test("maps to the stored values with the hand entry's flag rule", () => {
    expect(deviceReadingRow(msg, { minMilli: 20_000, maxMilli: 70_000 }, NOW)).toEqual({ valueMilli: 72_500, flag: "high", readAt: new Date(NOW - 1000), source: "device" });
    expect(deviceReadingRow({ ...msg, value: 45 }, { minMilli: 20_000, maxMilli: 70_000 }, NOW)?.flag).toBe("ok");
    expect(deviceReadingRow({ ...msg, value: 10 }, { minMilli: 20_000, maxMilli: null }, NOW)?.flag).toBe("low");
  });
  test("refuses what cannot be a reading", () => {
    expect(deviceReadingRow({ ...msg, value: Number.NaN }, { minMilli: null, maxMilli: 1 }, NOW)).toBeNull();
    expect(deviceReadingRow({ ...msg, value: 1e9 }, { minMilli: null, maxMilli: 1 }, NOW)).toBeNull();
    expect(deviceReadingRow({ ...msg, readAt: NOW + DEVICE_CLOCK_SKEW_MS + 1 }, { minMilli: null, maxMilli: 1 }, NOW)).toBeNull();
  });
});
