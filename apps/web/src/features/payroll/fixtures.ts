/** Payslip figures for the payroll tests, made by the domain's own `computePayslip` (never typed by hand). */
import { computePayslip, DEFAULT_HR_RULES, DEFAULT_STATUTORY_RATES, type PayLine } from "@orrn/domain";
import type { SlipFigures } from "@orrn/server/lib/hr/payroll";

export function slipFigures(over: { basic?: number; da?: number; hra?: number; paidHalves?: number; lopHalves?: number; overtimeMin?: number; esicCovered?: boolean; pfOnActual?: boolean; deductions?: PayLine[]; extra?: PayLine[]; name?: string; notMarked?: number } = {}): SlipFigures {
  const slip = computePayslip({
    month: "2026-11",
    structure: { basicPaise: over.basic ?? 12_000_00, daPaise: over.da ?? 0, hraPaise: over.hra ?? 0, otherPaise: 0, perDay: false, pfOnActual: over.pfOnActual ?? false, pfMember: true, esicMember: true, ptApplies: true },
    sheet: { paidHalves: over.paidHalves ?? 60, overtimeMin: over.overtimeMin ?? 0, lopHalves: over.lopHalves ?? 0 },
    rules: DEFAULT_HR_RULES,
    rates: DEFAULT_STATUTORY_RATES,
    esicCovered: over.esicCovered ?? true,
    ageAtMonthStart: 30,
    extraEarnings: over.extra,
    deductions: over.deductions,
  });
  return {
    ...slip,
    person: { code: "E-001", name: over.name ?? "Ramesh Patel", uan: "100200300400", esicIp: null, department: "Press", designation: "Operator", bankMasked: "XXXXXX1234", joinedOn: "2024-04-01", leftOn: null },
    ncpDays: Math.ceil((over.lopHalves ?? 0) / 2),
    notMarked: over.notMarked ?? 0,
    structureFrom: "2026-04",
  };
}
