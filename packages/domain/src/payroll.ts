/**
 * XE parity lane HR (rows 86, 88, 89): payroll, statutory figures, full and final and incentive.
 * Money is integer paise; rates are basis points (1200 = 12%). Every rate and ceiling comes from a dated
 * setting (`StatutoryRates`, defaults below with a source note) so the plant or its CA corrects a figure
 * without a release (CONTRACTS-W3 touchpoint 4). Each statutory line carries its basis so the payslip
 * can explain it.
 */
import type { Timesheet } from "./hr";
import { recoveryBp } from "./pressRun";

export type PtSlab = { fromPaise: number; monthlyPaise: number };

export type StatutoryRates = {
  epfEmployeeBp: number;
  epsEmployerBp: number;
  /** Employer share to EPF = employer total (same as employee rate) minus EPS. */
  epfWageCeilingPaise: number;
  edliBp: number;
  epfAdminBp: number;
  /** EPS stops at this age (the whole employer share then goes to EPF). */
  epsMaxAge: number;
  esicEmployeeBp: number;
  esicEmployerBp: number;
  esicWageCeilingPaise: number;
  /** No employee share when the average daily wage is at or under this. */
  esicEmployeeExemptDailyPaise: number;
  /** Professional tax slabs on the month's gross; the highest slab at or under the gross applies. */
  ptState: string;
  ptSlabs: PtSlab[];
  bonusEligibleCeilingPaise: number;
  bonusCalcCeilingPaise: number;
  bonusMinBp: number;
  bonusMaxBp: number;
  gratuityMinYears: number;
  gratuityCeilingPaise: number;
};

/** Defaults with their source; the CA confirms them for the plant (report owner items). */
export const DEFAULT_STATUTORY_RATES: StatutoryRates = {
  epfEmployeeBp: 1200,
  epsEmployerBp: 833,
  epfWageCeilingPaise: 15_000_00,
  edliBp: 50,
  epfAdminBp: 50,
  epsMaxAge: 58,
  esicEmployeeBp: 75,
  esicEmployerBp: 325,
  esicWageCeilingPaise: 21_000_00,
  esicEmployeeExemptDailyPaise: 176_00,
  ptState: "GJ",
  ptSlabs: [
    { fromPaise: 0, monthlyPaise: 0 },
    // Gujarat schedule (01/04/2022): up to 12,000 nil, more than 12,000 pays 200 a month.
    { fromPaise: 12_000_01, monthlyPaise: 200_00 },
  ],
  bonusEligibleCeilingPaise: 21_000_00,
  bonusCalcCeilingPaise: 7_000_00,
  bonusMinBp: 833,
  bonusMaxBp: 2000,
  gratuityMinYears: 5,
  gratuityCeilingPaise: 20_00_000_00,
};

export const DEFAULT_STATUTORY_NOTE =
  "Defaults: EPF and MP Act 1952 (12%, EPS 8.33%, wage ceiling 15,000, EDLI 0.5%, admin 0.5%); ESI Act 1948 (0.75% and 3.25%, ceiling 21,000); Gujarat professional tax (nil up to 12,000, 200 above 12,000, from 1 April 2022); EPF admin minimum 500 per month per plant; Payment of Bonus Act 1965 (8.33% to 20%, eligibility 21,000, calculation 7,000); Payment of Gratuity Act 1972 (15/26, 5 years, ceiling 20 lakh). The labour codes are in force from 21 November 2025 with the old rules kept until new rules are notified; confirm the wage definition and every figure with your CA.";

/** Plant HR rules, dated like the statutory rates. */
export type HrRules = {
  retirementAge: number;
  /** 0 = Sunday. */
  weeklyOffDow: number;
  overtimeMinMinutes: number;
  overtimeStepMinutes: number;
  /** Overtime pay as a multiple of the ordinary hourly rate, in hundredths (200 = twice). */
  overtimeRateX100: number;
  /** Ordinary rate base for overtime. */
  overtimeBase: "basic_da" | "gross";
  hoursPerDay: number;
  /** Days a monthly salary is divided by: the days of the month, or a fixed 26 or 30. */
  monthDaysBasis: "calendar" | 26 | 30;
  bonusBp: number;
  /** Leave encashment and gratuity divide basic + DA by this. */
  encashDivisor: number;
};

export const DEFAULT_HR_RULES: HrRules = {
  retirementAge: 58,
  weeklyOffDow: 0,
  overtimeMinMinutes: 30,
  overtimeStepMinutes: 30,
  overtimeRateX100: 200,
  overtimeBase: "basic_da",
  hoursPerDay: 8,
  monthDaysBasis: "calendar",
  bonusBp: 833,
  encashDivisor: 26,
};

/** Incentive rule (row 89): rate per good kg above a target per shift, a recovery floor and a reject penalty. */
export type IncentiveRule = {
  targetG: number;
  ratePaisePerKg: number;
  recoveryFloorBp: number;
  rejectPenaltyPaisePerKg: number;
};
export const DEFAULT_INCENTIVE_RULE: IncentiveRule = { targetG: 0, ratePaisePerKg: 0, recoveryFloorBp: 0, rejectPenaltyPaisePerKg: 0 };

/** Pick the dated row in force for `month` (`YYYY-MM`): the latest `effectiveFrom` at or before it. */
export function datedFor<T extends { effectiveFrom: string }>(rows: readonly T[], month: string): T | null {
  let best: T | null = null;
  for (const r of rows) if (r.effectiveFrom <= month && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best;
}

const pct = (paise: number, bp: number) => (paise * bp) / 10_000;
/** Nearest rupee, in paise. */
export const roundRupee = (paise: number) => Math.round(paise / 100) * 100;
/** Next higher rupee, in paise. */
export const ceilRupee = (paise: number) => Math.ceil(Math.round(paise) / 100) * 100;

export function ptFor(grossPaise: number, slabs: readonly PtSlab[]): number {
  let out = 0;
  let from = -1;
  for (const s of slabs) if (s.fromPaise <= grossPaise && s.fromPaise > from) {
    from = s.fromPaise;
    out = s.monthlyPaise;
  }
  return out;
}

export function monthDayCount(month: string, basis: HrRules["monthDaysBasis"]): number {
  if (basis !== "calendar") return basis;
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** ESIC contribution period of a month: April-September or October-March, named by its first month. */
export function esicPeriodStart(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  if (m >= 4 && m <= 9) return `${y}-04`;
  return m >= 10 ? `${y}-10` : `${y - 1}-10`;
}

export type SalaryStructure = {
  basicPaise: number;
  daPaise: number;
  hraPaise: number;
  otherPaise: number;
  /** true: the amounts are per day worked; false: per month. */
  perDay: boolean;
  /** EPF on the whole basic + DA instead of the ceiling (the person and plant opted in). */
  pfOnActual: boolean;
  pfMember: boolean;
  esicMember: boolean;
  ptApplies: boolean;
};

export type PayLine = { code: string; label?: string; paise: number };

export type Payslip = {
  month: string;
  monthDays: number;
  paidHalves: number;
  earnings: PayLine[];
  grossPaise: number;
  deductions: PayLine[];
  totalDeductionsPaise: number;
  netPaise: number;
  employer: PayLine[];
  epf: { wagesPaise: number; pfWagePaise: number; epsWagePaise: number; edliWagePaise: number; employeePaise: number; epsPaise: number; erEpfPaise: number; edliPaise: number; adminPaise: number; rateBp: number; ceilingPaise: number; capped: boolean } | null;
  esic: { wagesPaise: number; employeePaise: number; employerPaise: number; covered: boolean; reason: "covered" | "over_ceiling" | "not_member" | "exempt_low_wage" } | null;
  pt: { paise: number; state: string } | null;
  overtime: { minutes: number; hourlyPaise: number; rateX100: number; paise: number };
  /** Bonus earned this month on the calculation ceiling (paid yearly or at full and final). */
  bonusAccrualPaise: number;
  /** Basic + DA for the full month (gratuity, encashment). */
  fullBasicDaPaise: number;
};

/**
 * One person's month. `paidHalves` from `timesheet`; extra earnings (incentive) and deductions (advance,
 * canteen, other, TDS typed by the office) come in as lines. `esicCovered` is the contribution-period rule
 * the server resolved: covered at the start of the period stays covered to its end.
 */
export function computePayslip(input: {
  month: string;
  structure: SalaryStructure;
  sheet: Pick<Timesheet, "paidHalves" | "overtimeMin" | "lopHalves">;
  rules: HrRules;
  rates: StatutoryRates;
  esicCovered: boolean;
  ageAtMonthStart: number | null;
  extraEarnings?: readonly PayLine[];
  deductions?: readonly PayLine[];
}): Payslip {
  const { structure: s, rules, rates } = input;
  const monthDays = monthDayCount(input.month, rules.monthDaysBasis);
  // Paid days on the basis: the month's loss of pay is taken from the basis days.
  const paidHalves = Math.max(0, Math.min(monthDays * 2, monthDays * 2 - input.sheet.lopHalves));
  const paidHalvesCalendar = input.sheet.paidHalves;
  const earn = (amount: number) =>
    s.perDay ? Math.round((amount * paidHalvesCalendar) / 2) : Math.round((amount * paidHalves) / (monthDays * 2));
  const basic = earn(s.basicPaise);
  const da = earn(s.daPaise);
  const hra = earn(s.hraPaise);
  const other = earn(s.otherPaise);
  const fullBasicDa = s.perDay ? (s.basicPaise + s.daPaise) * monthDays : s.basicPaise + s.daPaise;
  const fullGross = s.perDay ? (s.basicPaise + s.daPaise + s.hraPaise + s.otherPaise) * monthDays : s.basicPaise + s.daPaise + s.hraPaise + s.otherPaise;
  const otBase = rules.overtimeBase === "gross" ? fullGross : fullBasicDa;
  const hourly = Math.round(otBase / monthDays / Math.max(1, rules.hoursPerDay));
  const otPaise = Math.round((hourly * input.sheet.overtimeMin * rules.overtimeRateX100) / 60 / 100);

  const earnings: PayLine[] = [
    { code: "basic", paise: basic },
    { code: "da", paise: da },
    { code: "hra", paise: hra },
    { code: "other", paise: other },
  ];
  if (otPaise > 0) earnings.push({ code: "overtime", paise: otPaise });
  for (const e of input.extraEarnings ?? []) if (e.paise !== 0) earnings.push(e);
  const gross = earnings.reduce((a, e) => a + e.paise, 0);

  const deductions: PayLine[] = [];
  const employer: PayLine[] = [];

  let epf: Payslip["epf"] = null;
  if (s.pfMember) {
    const wages = basic + da;
    const capped = !s.pfOnActual && wages > rates.epfWageCeilingPaise;
    const pfWage = s.pfOnActual ? wages : Math.min(wages, rates.epfWageCeilingPaise);
    const epsAllowed = input.ageAtMonthStart === null || input.ageAtMonthStart < rates.epsMaxAge;
    const epsWage = epsAllowed ? Math.min(wages, rates.epfWageCeilingPaise) : 0;
    const edliWage = Math.min(wages, rates.epfWageCeilingPaise);
    const employee = roundRupee(pct(pfWage, rates.epfEmployeeBp));
    const eps = roundRupee(pct(epsWage, rates.epsEmployerBp));
    const erTotal = roundRupee(pct(pfWage, rates.epfEmployeeBp));
    const erEpf = erTotal - eps;
    const edli = roundRupee(pct(edliWage, rates.edliBp));
    const admin = roundRupee(pct(pfWage, rates.epfAdminBp));
    epf = { wagesPaise: wages, pfWagePaise: pfWage, epsWagePaise: epsWage, edliWagePaise: edliWage, employeePaise: employee, epsPaise: eps, erEpfPaise: erEpf, edliPaise: edli, adminPaise: admin, rateBp: rates.epfEmployeeBp, ceilingPaise: rates.epfWageCeilingPaise, capped };
    deductions.push({ code: "epf", paise: employee });
    employer.push({ code: "eps", paise: eps }, { code: "er_epf", paise: erEpf }, { code: "edli", paise: edli }, { code: "epf_admin", paise: admin });
  }

  let esic: Payslip["esic"] = null;
  if (!s.esicMember) esic = { wagesPaise: gross, employeePaise: 0, employerPaise: 0, covered: false, reason: "not_member" };
  else if (!input.esicCovered) esic = { wagesPaise: gross, employeePaise: 0, employerPaise: 0, covered: false, reason: "over_ceiling" };
  else {
    const workedDays = Math.max(1, paidHalvesCalendar / 2);
    const exempt = gross / workedDays <= rates.esicEmployeeExemptDailyPaise;
    const employee = exempt ? 0 : ceilRupee(pct(gross, rates.esicEmployeeBp));
    const employerPaise = ceilRupee(pct(gross, rates.esicEmployerBp));
    esic = { wagesPaise: gross, employeePaise: employee, employerPaise, covered: true, reason: exempt ? "exempt_low_wage" : "covered" };
    if (employee > 0) deductions.push({ code: "esic", paise: employee });
    employer.push({ code: "esic_er", paise: employerPaise });
  }

  let pt: Payslip["pt"] = null;
  if (s.ptApplies) {
    const paise = ptFor(gross, rates.ptSlabs);
    pt = { paise, state: rates.ptState };
    if (paise > 0) deductions.push({ code: "pt", paise });
  }

  for (const d of input.deductions ?? []) if (d.paise > 0) deductions.push(d);
  const totalDeductions = deductions.reduce((a, d) => a + d.paise, 0);

  // Bonus Act: eligible when the full basic + DA is at or under the eligibility ceiling.
  const bonusAccrual =
    fullBasicDa <= rates.bonusEligibleCeilingPaise
      ? Math.round(pct(Math.min(basic + da, Math.round((rates.bonusCalcCeilingPaise * paidHalves) / (monthDays * 2))), clampBonus(rules.bonusBp, rates)))
      : 0;

  return {
    month: input.month,
    monthDays,
    paidHalves: s.perDay ? paidHalvesCalendar : paidHalves,
    earnings,
    grossPaise: gross,
    deductions,
    totalDeductionsPaise: totalDeductions,
    netPaise: gross - totalDeductions,
    employer,
    epf,
    esic,
    pt,
    overtime: { minutes: input.sheet.overtimeMin, hourlyPaise: hourly, rateX100: rules.overtimeRateX100, paise: otPaise },
    bonusAccrualPaise: bonusAccrual,
    fullBasicDaPaise: fullBasicDa,
  };
}

export function clampBonus(bp: number, rates: Pick<StatutoryRates, "bonusMinBp" | "bonusMaxBp">): number {
  return Math.min(rates.bonusMaxBp, Math.max(rates.bonusMinBp, bp));
}

/**
 * ESIC contribution-period rule: covered at the start of the period (first month's gross at or under the
 * ceiling, or the office marked the person covered) stays covered to the period's end. `firstGrossPaise`
 * is the gross of the earliest run in this period, or null when this is the first.
 */
export function esicCoveredFor(input: { coveredFlag: boolean | null; firstGrossPaise: number | null; thisGrossPaise: number; ceilingPaise: number }): boolean {
  if (input.coveredFlag !== null) return input.coveredFlag;
  const basis = input.firstGrossPaise ?? input.thisGrossPaise;
  return basis <= input.ceilingPaise;
}

// ---------------------------------------------------------------------------
// Gratuity, encashment, full and final (row 86)
// ---------------------------------------------------------------------------

/** Years counted for gratuity: completed years, plus one when more than six months of the last year were served. */
export function gratuityYears(service: { years: number; months: number; days: number }): number {
  return service.years + (service.months > 6 || (service.months === 6 && service.days > 0) ? 1 : 0);
}

export function gratuity(input: { lastBasicDaPaise: number; service: { years: number; months: number; days: number }; rates: Pick<StatutoryRates, "gratuityMinYears" | "gratuityCeilingPaise"> }): {
  eligible: boolean;
  years: number;
  paise: number;
  capped: boolean;
} {
  const eligible = input.service.years >= input.rates.gratuityMinYears;
  const years = gratuityYears(input.service);
  if (!eligible) return { eligible, years, paise: 0, capped: false };
  const raw = Math.round((input.lastBasicDaPaise * 15 * years) / 26);
  return { eligible, years, paise: Math.min(raw, input.rates.gratuityCeilingPaise), capped: raw > input.rates.gratuityCeilingPaise };
}

export function leaveEncashment(halves: number, fullBasicDaPaise: number, divisor: number): number {
  return Math.round((fullBasicDaPaise * Math.max(0, halves)) / 2 / Math.max(1, divisor));
}

export type FinalSettlement = {
  lines: PayLine[];
  earningsPaise: number;
  recoveriesPaise: number;
  netPaise: number;
  gratuity: ReturnType<typeof gratuity>;
};

export function finalSettlement(input: {
  unpaidSalaryPaise: number;
  encashHalves: number;
  fullBasicDaPaise: number;
  divisor: number;
  service: { years: number; months: number; days: number };
  bonusDuePaise: number;
  recoveries: readonly PayLine[];
  rates: Pick<StatutoryRates, "gratuityMinYears" | "gratuityCeilingPaise">;
}): FinalSettlement {
  const g = gratuity({ lastBasicDaPaise: input.fullBasicDaPaise, service: input.service, rates: input.rates });
  const encash = leaveEncashment(input.encashHalves, input.fullBasicDaPaise, input.divisor);
  const lines: PayLine[] = [
    { code: "unpaid_salary", paise: input.unpaidSalaryPaise },
    { code: "leave_encashment", paise: encash },
    { code: "gratuity", paise: g.paise },
    { code: "bonus_due", paise: input.bonusDuePaise },
  ];
  const earnings = lines.reduce((a, l) => a + l.paise, 0);
  const recoveries = input.recoveries.reduce((a, l) => a + Math.max(0, l.paise), 0);
  return { lines: [...lines, ...input.recoveries.map((r) => ({ ...r, paise: -Math.abs(r.paise) }))], earningsPaise: earnings, recoveriesPaise: recoveries, netPaise: earnings - recoveries, gratuity: g };
}

// ---------------------------------------------------------------------------
// Government files (row 88)
// ---------------------------------------------------------------------------

export type EcrRow = {
  uan: string;
  name: string;
  grossPaise: number;
  epf: NonNullable<Payslip["epf"]>;
  ncpDays: number;
  refundPaise?: number;
};

const rupees = (paise: number) => String(Math.round(paise / 100));

/**
 * EPFO ECR text file: one line per member, fields joined by `#~#`, no header, whole rupees:
 * UAN, member name, gross wages, EPF wages, EPS wages, EDLI wages, EPF contribution (employee),
 * EPS contribution, EPF minus EPS (employer EPF), NCP days, refund of advances.
 */
export function ecrText(rows: readonly EcrRow[]): string {
  return rows
    .map((r) =>
      [
        r.uan.trim(),
        r.name.trim().toUpperCase().replace(/#~#/g, " "),
        rupees(r.grossPaise),
        rupees(r.epf.pfWagePaise),
        rupees(r.epf.epsWagePaise),
        rupees(r.epf.edliWagePaise),
        rupees(r.epf.employeePaise),
        rupees(r.epf.epsPaise),
        rupees(r.epf.erEpfPaise),
        String(r.ncpDays),
        rupees(r.refundPaise ?? 0),
      ].join("#~#"),
    )
    .join("\n");
}

export type EsicRow = { ipNumber: string; name: string; paidDays: number; wagesPaise: number; reasonCode: number; lastWorkingDay: string | null };

export const ESIC_HEADERS = [
  "IP Number",
  "IP Name",
  "No of Days for which wages paid/payable during the month",
  "Total Monthly Wages",
  "Reason Code for Zero workings days(numeric only; provide 0 for all other reasons- Click on the link for reference)",
  "Last Working Day( Format DD/MM/YYYY  or DD-MM-YYYY)",
] as const;

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** ESIC monthly contribution sheet (the portal's upload template columns), as CSV. Wages in whole rupees. */
export function esicCsv(rows: readonly EsicRow[]): string {
  const out = [ESIC_HEADERS.map(csvCell).join(",")];
  for (const r of rows) {
    out.push(
      [r.ipNumber.trim(), r.name.trim(), String(Math.floor(r.paidDays)), rupees(r.wagesPaise), String(r.reasonCode), r.lastWorkingDay ? dmy(r.lastWorkingDay) : ""].map(csvCell).join(","),
    );
  }
  return out.join("\n");
}

export type BankRow = { code: string; name: string; accountNo: string; ifsc: string; netPaise: number };

/** Bank transfer sheet: code, name, account, IFSC, amount in rupees with paise. */
export function bankCsv(rows: readonly BankRow[]): string {
  const out = ["Code,Name,Account number,IFSC,Amount"];
  for (const r of rows) out.push([r.code, r.name, r.accountNo, r.ifsc, (r.netPaise / 100).toFixed(2)].map(csvCell).join(","));
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Incentive (row 89)
// ---------------------------------------------------------------------------

export type IncentiveShiftRow = { goodG: number; inputG: number; rejectG: number };

/** One operator's shift: rate on good kg above the target, nothing below the recovery floor, minus the reject penalty; never below zero. */
export function incentiveFor(row: IncentiveShiftRow, rule: IncentiveRule): { recoveryBp: number | null; earnedPaise: number; penaltyPaise: number; paise: number; belowFloor: boolean } {
  const rec = recoveryBp(row.goodG, row.inputG);
  const belowFloor = rule.recoveryFloorBp > 0 && (rec === null || rec < rule.recoveryFloorBp);
  const earned = belowFloor ? 0 : Math.round((Math.max(0, row.goodG - rule.targetG) * rule.ratePaisePerKg) / 1000);
  const penalty = Math.round((Math.max(0, row.rejectG) * rule.rejectPenaltyPaisePerKg) / 1000);
  return { recoveryBp: rec, earnedPaise: earned, penaltyPaise: penalty, paise: Math.max(0, earned - penalty), belowFloor };
}

export function incentiveCsv(rows: readonly { code: string; name: string; day: string; shift: string; goodG: number; inputG: number; rejectG: number; paise: number }[]): string {
  const out = ["Code,Name,Day,Shift,Good kg,Input kg,Reject kg,Recovery %,Incentive"];
  for (const r of rows) {
    const rec = recoveryBp(r.goodG, r.inputG);
    out.push(
      [r.code, r.name, r.day, r.shift, (r.goodG / 1000).toFixed(3), (r.inputG / 1000).toFixed(3), (r.rejectG / 1000).toFixed(3), rec === null ? "" : (rec / 100).toFixed(2), (r.paise / 100).toFixed(2)]
        .map(csvCell)
        .join(","),
    );
  }
  return out.join("\n");
}

/** Validation of a statutory rates object typed by the office or CA. */
export function statutoryRatesError(r: StatutoryRates): string | null {
  const bps = [r.epfEmployeeBp, r.epsEmployerBp, r.edliBp, r.epfAdminBp, r.esicEmployeeBp, r.esicEmployerBp, r.bonusMinBp, r.bonusMaxBp];
  if (bps.some((b) => !Number.isInteger(b) || b < 0 || b > 5000)) return "rate";
  if (r.epsEmployerBp > r.epfEmployeeBp) return "eps_over_epf";
  if (r.bonusMinBp > r.bonusMaxBp) return "bonus_range";
  if (!r.ptSlabs.length || r.ptSlabs.some((s) => s.fromPaise < 0 || s.monthlyPaise < 0)) return "pt_slabs";
  return null;
}
