import { describe, expect, test } from "bun:test";

import {
  bankCsv,
  computePayslip,
  datedFor,
  DEFAULT_HR_RULES,
  DEFAULT_STATUTORY_RATES,
  ecrText,
  esicCoveredFor,
  esicCsv,
  esicPeriodStart,
  finalSettlement,
  gratuity,
  incentiveFor,
  ptFor,
  type SalaryStructure,
} from "./payroll";

const S: SalaryStructure = { basicPaise: 12_000_00, daPaise: 3_000_00, hraPaise: 2_000_00, otherPaise: 1_000_00, perDay: false, pfOnActual: false, pfMember: true, esicMember: true, ptApplies: true };
const full = { paidHalves: 60, overtimeMin: 120, lopHalves: 0 };

describe("payslip", () => {
  test("a full month with overtime: EPF, ESIC, professional tax and bonus accrual", () => {
    const p = computePayslip({ month: "2026-11", structure: S, sheet: full, rules: DEFAULT_HR_RULES, rates: DEFAULT_STATUTORY_RATES, esicCovered: true, ageAtMonthStart: 40 });
    expect(p.earnings).toEqual([
      { code: "basic", paise: 12_000_00 },
      { code: "da", paise: 3_000_00 },
      { code: "hra", paise: 2_000_00 },
      { code: "other", paise: 1_000_00 },
      { code: "overtime", paise: 250_00 },
    ]);
    expect(p.overtime).toEqual({ minutes: 120, hourlyPaise: 62_50, rateX100: 200, paise: 250_00 });
    expect(p.grossPaise).toBe(18_250_00);
    expect(p.epf).toMatchObject({ pfWagePaise: 15_000_00, employeePaise: 1_800_00, epsPaise: 1_250_00, erEpfPaise: 550_00, edliPaise: 75_00, adminPaise: 75_00, capped: false });
    // ESIC: 0.75% of 18,250 = 136.875, next rupee 137; employer 3.25% = 593.125, next rupee 594.
    expect(p.esic).toMatchObject({ employeePaise: 137_00, employerPaise: 594_00, covered: true });
    expect(p.pt).toEqual({ paise: 200_00, state: "GJ" });
    expect(p.deductions.map((d) => [d.code, d.paise])).toEqual([["epf", 1_800_00], ["esic", 137_00], ["pt", 200_00]]);
    expect(p.netPaise).toBe(18_250_00 - 2_137_00);
    expect(p.bonusAccrualPaise).toBe(583_10);
  });

  test("loss of pay prorates the month; deductions typed by the office come off", () => {
    const p = computePayslip({
      month: "2026-11",
      structure: S,
      sheet: { paidHalves: 54, overtimeMin: 0, lopHalves: 6 },
      rules: DEFAULT_HR_RULES,
      rates: DEFAULT_STATUTORY_RATES,
      esicCovered: true,
      ageAtMonthStart: 30,
      deductions: [{ code: "advance", paise: 1_000_00 }, { code: "tds", paise: 0 }],
    });
    expect(p.earnings[0]).toEqual({ code: "basic", paise: 10_800_00 });
    expect(p.deductions.find((d) => d.code === "advance")?.paise).toBe(1_000_00);
    expect(p.deductions.find((d) => d.code === "tds")).toBeUndefined();
  });

  test("over the wage ceiling: EPF capped, ESIC not covered; EPS stops at 58", () => {
    const rich = { ...S, basicPaise: 25_000_00, daPaise: 0, hraPaise: 0, otherPaise: 0 };
    const p = computePayslip({ month: "2026-11", structure: rich, sheet: { ...full, overtimeMin: 0 }, rules: DEFAULT_HR_RULES, rates: DEFAULT_STATUTORY_RATES, esicCovered: false, ageAtMonthStart: 59 });
    expect(p.epf).toMatchObject({ pfWagePaise: 15_000_00, employeePaise: 1_800_00, epsPaise: 0, erEpfPaise: 1_800_00, capped: true, epsWagePaise: 0 });
    expect(p.esic).toMatchObject({ covered: false, reason: "over_ceiling", employeePaise: 0 });
    expect(p.bonusAccrualPaise).toBe(0);
    const actual = computePayslip({ month: "2026-11", structure: { ...rich, pfOnActual: true }, sheet: { ...full, overtimeMin: 0 }, rules: DEFAULT_HR_RULES, rates: DEFAULT_STATUTORY_RATES, esicCovered: false, ageAtMonthStart: 30 });
    expect(actual.epf).toMatchObject({ pfWagePaise: 25_000_00, employeePaise: 3_000_00, epsPaise: 1_250_00, erEpfPaise: 1_750_00 });
  });

  test("per-day wages: amount times days paid", () => {
    const daily = { ...S, basicPaise: 500_00, daPaise: 0, hraPaise: 0, otherPaise: 0, perDay: true, pfMember: false, esicMember: false, ptApplies: false };
    const p = computePayslip({ month: "2026-11", structure: daily, sheet: { paidHalves: 51, overtimeMin: 0, lopHalves: 9 }, rules: DEFAULT_HR_RULES, rates: DEFAULT_STATUTORY_RATES, esicCovered: false, ageAtMonthStart: null });
    expect(p.grossPaise).toBe(12_750_00);
    expect(p.epf).toBeNull();
    expect(p.pt).toBeNull();
  });
});

describe("statutory helpers", () => {
  test("professional tax slab, Gujarat default", () => {
    expect(ptFor(11_999_00, DEFAULT_STATUTORY_RATES.ptSlabs)).toBe(0);
    expect(ptFor(12_000_00, DEFAULT_STATUTORY_RATES.ptSlabs)).toBe(0);
    expect(ptFor(12_000_01, DEFAULT_STATUTORY_RATES.ptSlabs)).toBe(200_00);
  });

  test("ESIC contribution period: covered at its start stays covered", () => {
    expect(esicPeriodStart("2026-11")).toBe("2026-10");
    expect(esicPeriodStart("2027-02")).toBe("2026-10");
    expect(esicPeriodStart("2026-05")).toBe("2026-04");
    expect(esicCoveredFor({ coveredFlag: null, firstGrossPaise: 20_000_00, thisGrossPaise: 23_000_00, ceilingPaise: 21_000_00 })).toBe(true);
    expect(esicCoveredFor({ coveredFlag: null, firstGrossPaise: null, thisGrossPaise: 23_000_00, ceilingPaise: 21_000_00 })).toBe(false);
    expect(esicCoveredFor({ coveredFlag: true, firstGrossPaise: null, thisGrossPaise: 23_000_00, ceilingPaise: 21_000_00 })).toBe(true);
  });

  test("dated settings: the latest at or before the month", () => {
    const rows = [{ effectiveFrom: "2025-04", v: 1 }, { effectiveFrom: "2026-10", v: 2 }, { effectiveFrom: "2027-04", v: 3 }];
    expect(datedFor(rows, "2026-11")?.v).toBe(2);
    expect(datedFor(rows, "2025-01")).toBeNull();
  });
});

describe("full and final", () => {
  test("gratuity from five years, the six-month rule, the ceiling", () => {
    const rates = DEFAULT_STATUTORY_RATES;
    expect(gratuity({ lastBasicDaPaise: 15_000_00, service: { years: 6, months: 6, days: 26 }, rates })).toEqual({ eligible: true, years: 7, paise: 60_576_92, capped: false });
    expect(gratuity({ lastBasicDaPaise: 15_000_00, service: { years: 4, months: 11, days: 0 }, rates }).paise).toBe(0);
    expect(gratuity({ lastBasicDaPaise: 5_00_000_00, service: { years: 30, months: 0, days: 0 }, rates })).toMatchObject({ paise: 20_00_000_00, capped: true });
  });

  test("statement lines and the net after recoveries", () => {
    const f = finalSettlement({
      unpaidSalaryPaise: 9_000_00,
      encashHalves: 20,
      fullBasicDaPaise: 13_000_00,
      divisor: 26,
      service: { years: 2, months: 1, days: 0 },
      bonusDuePaise: 3_500_00,
      recoveries: [{ code: "advance", paise: 2_000_00 }],
      rates: DEFAULT_STATUTORY_RATES,
    });
    expect(f.lines.map((l) => [l.code, l.paise])).toEqual([["unpaid_salary", 9_000_00], ["leave_encashment", 5_000_00], ["gratuity", 0], ["bonus_due", 3_500_00], ["advance", -2_000_00]]);
    expect(f.netPaise).toBe(15_500_00);
  });
});

describe("government files", () => {
  test("EPF ECR line, exact", () => {
    const p = computePayslip({ month: "2026-11", structure: S, sheet: full, rules: DEFAULT_HR_RULES, rates: DEFAULT_STATUTORY_RATES, esicCovered: true, ageAtMonthStart: 40 });
    expect(ecrText([{ uan: "100200300400", name: "Ramesh Patel", grossPaise: p.grossPaise, epf: p.epf!, ncpDays: 0 }, { uan: "100200300401", name: "Asha Ben", grossPaise: 9_000_00, epf: { ...p.epf!, pfWagePaise: 9_000_00, epsWagePaise: 9_000_00, edliWagePaise: 9_000_00, employeePaise: 1_080_00, epsPaise: 750_00, erEpfPaise: 330_00 }, ncpDays: 3 }])).toBe(
      "100200300400#~#RAMESH PATEL#~#18250#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0\n100200300401#~#ASHA BEN#~#9000#~#9000#~#9000#~#9000#~#1080#~#750#~#330#~#3#~#0",
    );
  });

  test("ESIC monthly sheet, exact", () => {
    const csv = esicCsv([
      { ipNumber: "3112345678", name: "Ramesh Patel", paidDays: 30, wagesPaise: 18_250_00, reasonCode: 0, lastWorkingDay: null },
      { ipNumber: "3112345679", name: "Asha, Ben", paidDays: 0, wagesPaise: 0, reasonCode: 2, lastWorkingDay: "2026-11-10" },
    ]);
    expect(csv.split("\n").slice(1)).toEqual(["3112345678,Ramesh Patel,30,18250,0,", '3112345679,"Asha, Ben",0,0,2,10/11/2026']);
    expect(csv.split("\n")[0]!.startsWith("IP Number,IP Name,")).toBe(true);
  });

  test("bank sheet", () => {
    expect(bankCsv([{ code: "E001", name: "Ramesh", accountNo: "123456789", ifsc: "SBIN0001234", netPaise: 16_113_00 }])).toBe("Code,Name,Account number,IFSC,Amount\nE001,Ramesh,123456789,SBIN0001234,16113.00");
  });
});

describe("incentive", () => {
  const rule = { targetG: 1_000_000, ratePaisePerKg: 50, recoveryFloorBp: 7000, rejectPenaltyPaisePerKg: 100 };
  test("rate above target, reject penalty, recovery floor", () => {
    expect(incentiveFor({ goodG: 1_400_000, inputG: 1_800_000, rejectG: 20_000 }, rule)).toEqual({ recoveryBp: 7778, earnedPaise: 200_00, penaltyPaise: 20_00, paise: 180_00, belowFloor: false });
    expect(incentiveFor({ goodG: 1_400_000, inputG: 2_100_000, rejectG: 0 }, rule)).toMatchObject({ belowFloor: true, paise: 0 });
    expect(incentiveFor({ goodG: 900_000, inputG: 1_000_000, rejectG: 50_000 }, rule).paise).toBe(0);
  });
});
