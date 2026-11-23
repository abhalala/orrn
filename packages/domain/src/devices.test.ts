import { describe, expect, test } from "bun:test";

import {
  DEVICE_SETTINGS_DEFAULTS,
  deviceClock,
  deviceHealth,
  deviceMaySend,
  healthCounts,
  isDeviceCode,
  normaliseSampleCode,
  parseCsv,
  parseScannerCsv,
  parseUtmCsv,
  parseWeighbridgeCsv,
  readDeviceSettings,
  sameVehicle,
  weighbridgeNet,
  weighMismatch,
  withPlanNominals,
} from "./devices";

describe("weighbridge (row 48)", () => {
  test("net is gross minus tare; a tare at or above the gross is not a ticket", () => {
    expect(weighbridgeNet(18_400_000, 7_200_000)).toBe(11_200_000);
    expect(weighbridgeNet(7_000, 7_000)).toBeNull();
    expect(weighbridgeNet(0, 0)).toBeNull();
    expect(weighbridgeNet(10.5, 1)).toBeNull();
  });

  test("the kanta check: the larger of the share and the grams", () => {
    const s = { weighToleranceBp: 50, weighToleranceMinG: 20_000 };
    // 0.5 % of 11 200 kg = 56 kg allowed.
    expect(weighMismatch(11_250_000, 11_200_000, s)).toEqual({ diffG: 50_000, allowedG: 56_000, flagged: false });
    expect(weighMismatch(11_100_000, 11_200_000, s)).toEqual({ diffG: -100_000, allowedG: 56_000, flagged: true });
    // A small truck: the 20 kg floor wins.
    expect(weighMismatch(1_030_000, 1_000_000, s).allowedG).toBe(20_000);
    expect(weighMismatch(1_030_000, 1_000_000, s).flagged).toBe(true);
  });

  test("same truck ignores spaces, dashes and case", () => {
    expect(sameVehicle("GJ 05-ab 1234", "GJ05AB1234")).toBe(true);
    expect(sameVehicle("", "")).toBe(false);
    expect(sameVehicle("GJ05AB1234", "GJ05AB1235")).toBe(false);
  });

  test("settings: defaults, bounds", () => {
    expect(readDeviceSettings(null)).toEqual(DEVICE_SETTINGS_DEFAULTS);
    expect(readDeviceSettings({ devices: { weighToleranceBp: 100, weighToleranceMinG: 5000, heartbeatSec: 30 } })).toEqual({ weighToleranceBp: 100, weighToleranceMinG: 5000, heartbeatSec: 30 });
    expect(readDeviceSettings({ devices: { weighToleranceBp: -1, heartbeatSec: 1, weighToleranceMinG: "x" } })).toEqual(DEVICE_SETTINGS_DEFAULTS);
  });
});

describe("device clock and health (row 95)", () => {
  const now = Date.UTC(2026, 10, 22, 6, 0, 0);
  test("skew is measured from the sent time; a buffered old reading is kept", () => {
    const old = deviceClock({ sentAtMs: now - 1000, receivedAtMs: now, sampledAtMs: now - 3 * 3600_000 });
    expect(old).toEqual({ skewMs: 1000, sampledAtMs: now - 3 * 3600_000, unconfirmed: false, refused: false });
  });
  test("a clock 10 minutes fast is corrected and marked unconfirmed, not refused", () => {
    const fast = deviceClock({ sentAtMs: now + 600_000, receivedAtMs: now, sampledAtMs: now + 590_000 });
    expect(fast.unconfirmed).toBe(true);
    expect(fast.sampledAtMs).toBe(now - 10_000);
    expect(fast.refused).toBe(false);
  });
  test("a reading still in the future after correction is refused", () => {
    expect(deviceClock({ sentAtMs: now, receivedAtMs: now, sampledAtMs: now + 6 * 60_000 }).refused).toBe(true);
  });
  test("live, late, silent, never, revoked", () => {
    const h = (age: number | null, revoked = false) => deviceHealth({ revoked, lastSeenAtMs: age == null ? null : now - age, nowMs: now, heartbeatSec: 60 });
    expect(h(60_000)).toBe("live");
    expect(h(5 * 60_000)).toBe("late");
    expect(h(11 * 60_000)).toBe("silent");
    expect(h(null)).toBe("never");
    expect(h(1, true)).toBe("revoked");
    expect(healthCounts([{ health: "live", simulated: true }, { health: "revoked", simulated: true }, { health: "silent", simulated: false }])).toEqual({
      live: 1,
      late: 0,
      silent: 1,
      never: 0,
      revoked: 1,
      simulated: 1,
      total: 2,
    });
  });
  test("what each device may send", () => {
    expect(deviceMaySend("weighbridge", "weighbridge")).toBe(true);
    expect(deviceMaySend("weighbridge", "dimension")).toBe(false);
    expect(deviceMaySend("utm", "mechanical")).toBe(true);
    expect(deviceMaySend("plc", "mechanical")).toBe(false);
  });
  test("codes", () => {
    expect(normaliseSampleCode(" pr- 12 ")).toBe("PR-12");
    expect(isDeviceCode("WB-1")).toBe(true);
    expect(isDeviceCode("w")).toBe(false);
  });
});

describe("CSV files", () => {
  test("quotes, semicolons and blank lines", () => {
    expect(parseCsv('a;b\n"x;1";"say ""hi"""\n\n')).toEqual([["a", "b"], ["x;1", 'say "hi"']]);
  });

  test("weighbridge export in tonnes with a plant-time column", () => {
    const csv = "Ticket No,Vehicle No,Gross,Tare,Net,Date Time\nT-101,GJ 05 AB 1234,18.400,7.200,11.200,22/11/2026 10:30\nT-102,,7.000,8.000,,2026-11-22 10:40\nT-103,GJ05,9.000,1.000,7.000,2026-11-22 10:50\n";
    const { rows, errors } = parseWeighbridgeCsv(csv, "t", 330);
    expect(rows).toEqual([{ line: 2, ticketNo: "T-101", vehicleNo: "GJ05AB1234", grossG: 18_400_000, tareG: 7_200_000, netG: 11_200_000, atMs: Date.UTC(2026, 10, 22, 5, 0) }]);
    expect(errors).toEqual([
      { line: 3, code: "tare_above_gross" },
      { line: 4, code: "net_mismatch" },
    ]);
  });

  test("weighbridge export in kg", () => {
    const { rows } = parseWeighbridgeCsv("slip,truck,gross wt,tare wt,time\n55,MH12XY9,18400,7200,2026-11-22T10:30:00+05:30\n", "kg", 330);
    expect(rows[0]).toMatchObject({ ticketNo: "55", grossG: 18_400_000, netG: 11_200_000, atMs: Date.UTC(2026, 10, 22, 5, 0) });
  });

  test("scanner export groups lines of one sample", () => {
    const csv = "sample,dimension,measured_mm,nominal_mm,minus_mm,plus_mm,time\nPR-12,Width,40.12,40,0.2,0.2,2026-11-22 09:00\npr-12 ,Wall,1.50,,,,2026-11-22 09:00\nPR-13,Width,abc,,,,2026-11-22 09:00\n";
    const { samples, errors } = parseScannerCsv(csv, 0);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.sampleCode).toBe("PR-12");
    expect(samples[0]!.points).toEqual([
      { name: "Width", measuredUm: 40_120, nominalUm: 40_000, minusUm: 200, plusUm: 200 },
      { name: "Wall", measuredUm: 1500, nominalUm: null, minusUm: null, plusUm: null },
    ]);
    expect(errors).toEqual([{ line: 4, code: "bad_number" }]);
  });

  test("tensile export", () => {
    const { rows, errors } = parseUtmCsv("specimen,UTS,Rp0.2,Elongation %,time\nPR-12,215,180,10.5,2026-11-22 11:00\nPR-13,,,,2026-11-22 11:00\n", 0);
    expect(rows).toEqual([{ line: 2, sampleCode: "PR-12", atMs: Date.UTC(2026, 10, 22, 11, 0), tensileMpa: 215, yieldMpa: 180, elongationX10: 105 }]);
    expect(errors).toEqual([{ line: 3, code: "missing" }]);
  });

  test("too many rows is one error", () => {
    const csv = `ticket,gross,tare,time\n${Array.from({ length: 501 }, (_, i) => `${i},2,1,2026-11-22 10:00`).join("\n")}`;
    expect(parseWeighbridgeCsv(csv, "t", 0)).toEqual({ rows: [], errors: [{ line: 0, code: "too_many" }] });
  });

  test("plan nominals fill what the scanner did not send", () => {
    const out = withPlanNominals(
      [
        { name: "Wall", measuredUm: 1500, nominalUm: null, minusUm: null, plusUm: null },
        { name: "Flange", measuredUm: 20_000, nominalUm: null, minusUm: null, plusUm: null },
      ],
      [{ name: "wall", nominalUm: 1600, minusUm: 50, plusUm: 50 }],
    );
    expect(out.complete).toEqual([{ name: "Wall", nominalUm: 1600, minusUm: 50, plusUm: 50, measuredUm: 1500 }]);
    expect(out.unknown).toEqual(["Flange"]);
  });
});
