/**
 * The words of a payslip and of a full and final statement: every line named and every statutory figure
 * explained in a sentence ("EPF 12% of 15,000, the wage ceiling ..."). Pure: it takes the server's figures and the
 * viewer's `t`, so the office screen, the printed A4 page and the phone say the same thing. Nothing is worked out
 * again here except the plain words around the server's figures. The phone keeps a byte-equal copy
 * (`apps/native/features/me/explain.ts`, `apps/native/__tests__/me-model.test.ts` compares them): never import a
 * web module from this file.
 */
import { rupeesText, type PayLine } from "@orrn/domain";
import type { MessageKey, Translate } from "@orrn/i18n";
import type { SlipFigures } from "@orrn/server/lib/hr/payroll";

export type SlipLine = { name: string; paise: number; why: string | null };

export type SlipView = {
  earnings: SlipLine[];
  deductions: SlipLine[];
  employer: SlipLine[];
  /** Sentences under the table: paid days, days without pay, the structure date, a statutory line that took nothing. */
  notes: string[];
  paidDays: string;
  monthDays: number;
  ncpDays: number;
  overtime: string | null;
};

export type SettlementFigures = {
  lines: PayLine[];
  earningsPaise: number;
  recoveriesPaise: number;
  netPaise: number;
  gratuity: { eligible: boolean; years: number; paise: number; capped: boolean };
  service: { years: number; months: number; days: number };
  person: { code: string; name: string; joinedOn: string; leftOn: string; reason: string | null };
  inputs: { unpaidHalves: number; encashHalves: number };
  fullBasicDaPaise: number;
  encashDivisor: number;
};

export type GratuityRates = { gratuityMinYears: number; gratuityCeilingPaise: number };

/** Rupees with Indian grouping; ".00" is left off a whole amount ("15,000"), paise stay ("15,000.50"). */
export function rs(paise: number): string {
  const text = rupeesText(Math.abs(paise));
  return `${paise < 0 ? "-" : ""}${text.endsWith(".00") ? text.slice(0, -3) : text}`;
}

/** Rupees with two decimals, signed, for the amount column of a paper. */
export function amountText(paise: number): string {
  return `${paise < 0 ? "-" : ""}${rupeesText(Math.abs(paise))}`;
}

/** A rate in hundredths of a percent as the percent text: 1200 -> "12", 833 -> "8.33", 50 -> "0.5". Cut from the digits, no division. */
export function bpText(bp: number): string {
  const digits = String(Math.abs(Math.round(bp))).padStart(3, "0");
  const whole = digits.slice(0, -2);
  const frac = digits.slice(-2).replace(/0+$/, "");
  return `${bp < 0 ? "-" : ""}${whole}${frac === "" ? "" : `.${frac}`}`;
}

/** 5 halves -> "2.5", 52 -> "26". */
export function halvesText(halves: number): string {
  return String(halves / 2);
}

const MONTH_KEYS: readonly MessageKey[] = [
  "payroll.payslip.month.m1",
  "payroll.payslip.month.m2",
  "payroll.payslip.month.m3",
  "payroll.payslip.month.m4",
  "payroll.payslip.month.m5",
  "payroll.payslip.month.m6",
  "payroll.payslip.month.m7",
  "payroll.payslip.month.m8",
  "payroll.payslip.month.m9",
  "payroll.payslip.month.m10",
  "payroll.payslip.month.m11",
  "payroll.payslip.month.m12",
];

/** "2026-11" -> "November 2026" in the viewer's language. */
export function monthName(t: Translate, month: string): string {
  const m = Number(month.slice(5, 7));
  const key = MONTH_KEYS[m - 1];
  return key ? `${t(key)} ${month.slice(0, 4)}` : month;
}

/** "2026-11-03" -> "03-11-2026" (cut from the text, no Intl). */
export function dmy(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd ?? "";
  return `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}`;
}

const EARNING_KEYS: Record<string, MessageKey> = {
  basic: "payroll.payslip.line.basic",
  da: "payroll.payslip.line.da",
  hra: "payroll.payslip.line.hra",
  other: "payroll.payslip.line.otherAllowance",
  overtime: "payroll.payslip.line.overtime",
  earning: "payroll.payslip.line.earning",
  incentive: "payroll.payslip.line.incentive",
};
const DEDUCTION_KEYS: Record<string, MessageKey> = {
  epf: "payroll.payslip.line.epf",
  esic: "payroll.payslip.line.esic",
  pt: "payroll.payslip.line.pt",
  advance: "payroll.payslip.line.advance",
  canteen: "payroll.payslip.line.canteen",
  other: "payroll.payslip.line.otherDeduction",
  tds: "payroll.payslip.line.tds",
};
const EMPLOYER_KEYS: Record<string, MessageKey> = {
  eps: "payroll.payslip.line.eps",
  er_epf: "payroll.payslip.line.er_epf",
  edli: "payroll.payslip.line.edli",
  epf_admin: "payroll.payslip.line.epf_admin",
  esic_er: "payroll.payslip.line.esic_er",
};

/** A line's name in the viewer's language, with the note the office typed after it ("Advance recovered: Diwali"). */
export function lineName(t: Translate, section: "earning" | "deduction" | "employer", line: PayLine): string {
  const keys = section === "earning" ? EARNING_KEYS : section === "deduction" ? DEDUCTION_KEYS : EMPLOYER_KEYS;
  const key = keys[line.code];
  const base = key ? t(key) : line.code;
  const note = line.label?.trim();
  return note ? `${base}: ${note}` : base;
}

export function timeText(t: Translate, minutes: number): string {
  return t("payroll.payslip.explain.time", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function explainEpf(t: Translate, epf: NonNullable<SlipFigures["epf"]>): string {
  const rate = bpText(epf.rateBp);
  if (epf.capped) return t("payroll.payslip.explain.epfCeiling", { rate, base: rs(epf.pfWagePaise), wages: rs(epf.wagesPaise) });
  if (epf.wagesPaise > epf.ceilingPaise) return t("payroll.payslip.explain.epfActual", { rate, base: rs(epf.pfWagePaise) });
  return t("payroll.payslip.explain.epf", { rate, base: rs(epf.pfWagePaise) });
}

export function explainEsic(t: Translate, esic: NonNullable<SlipFigures["esic"]>): string {
  switch (esic.reason) {
    case "covered":
      return t("payroll.payslip.explain.esic", { wages: rs(esic.wagesPaise) });
    case "exempt_low_wage":
      return t("payroll.payslip.explain.esicLow");
    case "over_ceiling":
      return t("payroll.payslip.explain.esicOver");
    default:
      return t("payroll.payslip.explain.esicNot");
  }
}

export function explainPt(t: Translate, pt: NonNullable<SlipFigures["pt"]>, grossPaise: number): string {
  return t(pt.paise > 0 ? "payroll.payslip.explain.pt" : "payroll.payslip.explain.ptNone", { state: pt.state, gross: rs(grossPaise) });
}

export function explainOvertime(t: Translate, ot: SlipFigures["overtime"]): string {
  return t("payroll.payslip.explain.overtime", { time: timeText(t, ot.minutes), rate: bpText(ot.rateX100), hourly: rs(ot.hourlyPaise) });
}

/** The whole payslip as lines and sentences in the viewer's language. */
export function slipView(t: Translate, f: SlipFigures): SlipView {
  // An allowance the person does not have (0.00) is left off; basic always stays.
  const earnings: SlipLine[] = f.earnings
    .filter((l) => l.paise !== 0 || l.code === "basic")
    .map((l) => ({
    name: lineName(t, "earning", l),
    paise: l.paise,
      why: l.code === "overtime" ? explainOvertime(t, f.overtime) : null,
    }));
  const deductions: SlipLine[] = f.deductions.map((l) => ({
    name: lineName(t, "deduction", l),
    paise: l.paise,
    why: l.code === "epf" && f.epf ? explainEpf(t, f.epf) : l.code === "esic" && f.esic ? explainEsic(t, f.esic) : l.code === "pt" && f.pt ? explainPt(t, f.pt, f.grossPaise) : null,
  }));
  const employer: SlipLine[] = f.employer.map((l) => ({ name: lineName(t, "employer", l), paise: l.paise, why: null }));

  const notes: string[] = [t("payroll.payslip.explain.paid", { paid: halvesText(f.paidHalves), days: f.monthDays })];
  if (f.ncpDays > 0) notes.push(t("payroll.payslip.explain.noPay", { count: f.ncpDays }));
  if (f.notMarked > 0) notes.push(t("payroll.payslip.explain.notMarked", { count: f.notMarked }));
  notes.push(t("payroll.payslip.explain.structure", { month: monthName(t, f.structureFrom) }));
  // A statutory line that took nothing has no row, so its sentence goes here.
  if (f.esic && !f.deductions.some((d) => d.code === "esic")) notes.push(explainEsic(t, f.esic));
  if (f.pt && f.pt.paise === 0) notes.push(explainPt(t, f.pt, f.grossPaise));
  return {
    earnings,
    deductions,
    employer,
    notes,
    paidDays: halvesText(f.paidHalves),
    monthDays: f.monthDays,
    ncpDays: f.ncpDays,
    overtime: f.overtime.minutes > 0 ? timeText(t, f.overtime.minutes) : null,
  };
}

export type SettlementView = { lines: SlipLine[]; netPaise: number; service: string };

const FNF_KEYS: Record<string, MessageKey> = {
  unpaid_salary: "payroll.payslip.fnf.line.unpaid_salary",
  leave_encashment: "payroll.payslip.fnf.line.leave_encashment",
  gratuity: "payroll.payslip.fnf.line.gratuity",
  bonus_due: "payroll.payslip.fnf.line.bonus_due",
  recovery: "payroll.payslip.fnf.line.recovery",
};

/** The full and final statement as lines and sentences. `rates` (gratuity years and ceiling in force) sharpens the gratuity sentence. */
export function settlementView(t: Translate, f: SettlementFigures, rates: GratuityRates | null): SettlementView {
  const g = f.gratuity;
  const lines: SlipLine[] = f.lines.map((l) => {
    const key = FNF_KEYS[l.code];
    const base = key ? t(key) : l.code;
    const name = l.code === "recovery" && l.label?.trim() ? `${base}: ${l.label.trim()}` : base;
    let why: string | null = null;
    if (l.code === "unpaid_salary") why = t("payroll.payslip.fnf.explain.unpaid", { days: halvesText(f.inputs.unpaidHalves) });
    else if (l.code === "leave_encashment") why = t("payroll.payslip.fnf.explain.encash", { days: halvesText(f.inputs.encashHalves), basic: rs(f.fullBasicDaPaise), divisor: f.encashDivisor });
    else if (l.code === "gratuity") {
      if (!g.eligible) why = rates ? t("payroll.payslip.fnf.explain.gratuityNot", { min: rates.gratuityMinYears, years: f.service.years }) : t("payroll.payslip.fnf.explain.gratuityNone");
      else if (g.capped && rates) why = t("payroll.payslip.fnf.explain.gratuityCapped", { basic: rs(f.fullBasicDaPaise), years: g.years, ceiling: rs(rates.gratuityCeilingPaise) });
      else why = t("payroll.payslip.fnf.explain.gratuity", { basic: rs(f.fullBasicDaPaise), years: g.years });
    } else if (l.code === "bonus_due") why = t("payroll.payslip.fnf.explain.bonus");
    else if (l.code === "recovery") why = t("payroll.payslip.fnf.explain.recovery");
    return { name, paise: l.paise, why };
  });
  return { lines, netPaise: f.netPaise, service: t("payroll.payslip.fnf.serviceValue", { years: f.service.years, months: f.service.months, days: f.service.days }) };
}
