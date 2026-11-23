/**
 * Payroll screens: the pure rules behind them (run states and what each allows, month lists, rupee and percent boxes,
 * the salary structure form, the statutory rates form, full and final inputs, totals). No view code, no tRPC, no clock:
 * the pages pass today in. Figures are integer paise. The words of a payslip are in `explain.ts`.
 */
import { datedFor, parseDecimal, statutoryRatesError, type StatutoryRates, type StatusTone } from "@orrn/domain";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

type Out = inferRouterOutputs<AppRouter>["payroll"];
export type RunRow = Out["runs"]["list"][number];
export type RunGet = Out["runs"]["get"];
export type SlipRow = RunGet["slips"][number];
export type StructureRow = Out["structures"]["register"][number];
export type AdjustmentRow = Out["adjustments"]["list"][number];
export type SettingsGet = Out["settings"]["get"];

export type RunStatus = "draft" | "checked" | "approved" | "locked";
export const RUN_STATES: readonly RunStatus[] = ["draft", "checked", "approved", "locked"];

export function stateTone(status: RunStatus): StatusTone {
  switch (status) {
    case "locked":
      return "green";
    case "approved":
      return "blue";
    case "checked":
      return "amber";
    default:
      return "neutral";
  }
}

export type RunActions = { compute: boolean; check: boolean; reopen: boolean; lock: boolean; files: boolean; approvalLink: boolean };

/** What the run screen may offer for a run in this state. Who may press each is `<Can>` and the server. */
export function runActions(run: { status: RunStatus; headcount: number } | null): RunActions {
  if (!run) return { compute: true, check: false, reopen: false, lock: false, files: false, approvalLink: false };
  return {
    compute: run.status === "draft",
    check: run.status === "draft" && run.headcount > 0,
    reopen: run.status === "checked" || run.status === "approved",
    lock: run.status === "approved",
    files: run.status === "approved" || run.status === "locked",
    approvalLink: run.status === "checked",
  };
}

export type RunTotals = { headcount: number; grossPaise: number; deductionsPaise: number; netPaise: number; unmarkedPeople: number };

export function runTotals(slips: readonly Pick<SlipRow, "grossPaise" | "netPaise" | "figures">[]): RunTotals {
  let gross = 0;
  let net = 0;
  let deductions = 0;
  let unmarked = 0;
  for (const s of slips) {
    gross += s.grossPaise;
    net += s.netPaise;
    deductions += s.figures.totalDeductionsPaise;
    if (s.figures.notMarked > 0) unmarked += 1;
  }
  return { headcount: slips.length, grossPaise: gross, deductionsPaise: deductions, netPaise: net, unmarkedPeople: unmarked };
}

/** "2026-11" and the `count - 1` months before it, newest first. */
export function recentMonths(todayYmd: string, count = 18): string[] {
  let y = Number(todayYmd.slice(0, 4));
  let m = Number(todayYmd.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export const isMonthText = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v.trim());

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

/** Rupees typed in a box to whole paise; null when it is not a plain amount with at most two decimals. */
export function rupeesToPaise(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null) return null;
  const frac = text.replace(/,/g, "").trim().split(".")[1] ?? "";
  if (frac.length > 2) return null;
  return Math.round(n * 100);
}

/** Paise as the text a box starts from ("1250.5" for 125050). */
export function paiseToBox(paise: number): string {
  return (paise / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** A percent typed in a box ("8.33") to basis points (833); null when it is not a plain number with at most two decimals. */
export function percentToBp(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null) return null;
  const frac = text.trim().split(".")[1] ?? "";
  if (frac.length > 2) return null;
  return Math.round(n * 100);
}

export function bpToPercent(bp: number): string {
  return (bp / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** A whole number in a box; null otherwise. */
export function wholeNumber(text: string): number | null {
  return /^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** Days typed in a box to halves of a day: "3" -> 6, "2.5" -> 5; null for anything else. */
export function daysToHalves(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null || n > 2000) return null;
  const halves = n * 2;
  return Number.isInteger(halves) ? halves : null;
}

// ---------------------------------------------------------------------------
// Salary structure
// ---------------------------------------------------------------------------

export type StructureForm = {
  employeeId: string;
  effectiveFrom: string;
  basic: string;
  da: string;
  hra: string;
  other: string;
  perDay: boolean;
  pfMember: boolean;
  pfOnActual: boolean;
  esicMember: boolean;
  esicCovered: "auto" | "yes" | "no";
  ptApplies: boolean;
};

export function emptyStructureForm(month: string, employeeId = ""): StructureForm {
  return { employeeId, effectiveFrom: month, basic: "", da: "", hra: "", other: "", perDay: false, pfMember: true, pfOnActual: false, esicMember: true, esicCovered: "auto", ptApplies: true };
}

export function formFromStructure(row: Pick<StructureRow, "employeeId" | "basicPaise" | "daPaise" | "hraPaise" | "otherPaise" | "perDay" | "pfMember" | "pfOnActual" | "esicMember" | "esicCovered" | "ptApplies">, month: string): StructureForm {
  const box = (p: number) => (p === 0 ? "" : paiseToBox(p));
  return {
    employeeId: row.employeeId,
    effectiveFrom: month,
    basic: paiseToBox(row.basicPaise),
    da: box(row.daPaise),
    hra: box(row.hraPaise),
    other: box(row.otherPaise),
    perDay: row.perDay,
    pfMember: row.pfMember,
    pfOnActual: row.pfOnActual,
    esicMember: row.esicMember,
    esicCovered: row.esicCovered === null ? "auto" : row.esicCovered ? "yes" : "no",
    ptApplies: row.ptApplies,
  };
}

export type StructureInput = {
  employeeId: string;
  effectiveFrom: string;
  basicPaise: number;
  daPaise: number;
  hraPaise: number;
  otherPaise: number;
  perDay: boolean;
  pfMember: boolean;
  pfOnActual: boolean;
  esicMember: boolean;
  esicCovered: boolean | null;
  ptApplies: boolean;
};
export type StructureError = "needPerson" | "needMonth" | "needBasic" | "badAmount";

export function structureInput(f: StructureForm): { ok: true; input: StructureInput } | { ok: false; error: StructureError } {
  if (!f.employeeId) return { ok: false, error: "needPerson" };
  if (!isMonthText(f.effectiveFrom)) return { ok: false, error: "needMonth" };
  if (f.basic.trim() === "") return { ok: false, error: "needBasic" };
  const amount = (text: string): number | null => (text.trim() === "" ? 0 : rupeesToPaise(text));
  const basic = rupeesToPaise(f.basic);
  const da = amount(f.da);
  const hra = amount(f.hra);
  const other = amount(f.other);
  if (basic === null || da === null || hra === null || other === null) return { ok: false, error: "badAmount" };
  if (basic <= 0) return { ok: false, error: "needBasic" };
  return {
    ok: true,
    input: {
      employeeId: f.employeeId,
      effectiveFrom: f.effectiveFrom.trim(),
      basicPaise: basic,
      daPaise: da,
      hraPaise: hra,
      otherPaise: other,
      perDay: f.perDay,
      pfMember: f.pfMember,
      pfOnActual: f.pfMember && f.pfOnActual,
      esicMember: f.esicMember,
      esicCovered: f.esicMember ? (f.esicCovered === "auto" ? null : f.esicCovered === "yes") : null,
      ptApplies: f.ptApplies,
    },
  };
}

// ---------------------------------------------------------------------------
// Deductions and extra pay
// ---------------------------------------------------------------------------

export const ADJUSTMENT_KINDS = ["advance", "canteen", "other", "tds", "earning"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export type AdjustmentError = "needPerson" | "needAmount";

export function adjustmentInput(f: { employeeId: string; kind: AdjustmentKind; label: string; amount: string }): { ok: true; input: { employeeId: string; kind: AdjustmentKind; label: string | null; amountPaise: number } } | { ok: false; error: AdjustmentError } {
  if (!f.employeeId) return { ok: false, error: "needPerson" };
  const paise = rupeesToPaise(f.amount);
  if (paise === null || paise <= 0) return { ok: false, error: "needAmount" };
  const label = f.label.trim();
  return { ok: true, input: { employeeId: f.employeeId, kind: f.kind, label: label === "" ? null : label.slice(0, 60), amountPaise: paise } };
}

export function adjustmentTotals(rows: readonly Pick<AdjustmentRow, "kind" | "amountPaise">[]): { deductionsPaise: number; earningsPaise: number } {
  let deductions = 0;
  let earnings = 0;
  for (const r of rows) {
    if (r.kind === "earning") earnings += r.amountPaise;
    else deductions += r.amountPaise;
  }
  return { deductionsPaise: deductions, earningsPaise: earnings };
}

// ---------------------------------------------------------------------------
// Statutory rates
// ---------------------------------------------------------------------------

export type RatesForm = {
  effectiveFrom: string;
  epfEmployee: string;
  epsEmployer: string;
  epfCeiling: string;
  edli: string;
  epfAdmin: string;
  epsMaxAge: string;
  esicEmployee: string;
  esicEmployer: string;
  esicCeiling: string;
  esicExempt: string;
  ptState: string;
  slabs: { from: string; tax: string }[];
  bonusEligible: string;
  bonusCalc: string;
  bonusMin: string;
  bonusMax: string;
  gratuityMin: string;
  gratuityCeiling: string;
  note: string;
};

export function ratesToForm(r: StatutoryRates, month: string, note = ""): RatesForm {
  return {
    effectiveFrom: month,
    epfEmployee: bpToPercent(r.epfEmployeeBp),
    epsEmployer: bpToPercent(r.epsEmployerBp),
    epfCeiling: paiseToBox(r.epfWageCeilingPaise),
    edli: bpToPercent(r.edliBp),
    epfAdmin: bpToPercent(r.epfAdminBp),
    epsMaxAge: String(r.epsMaxAge),
    esicEmployee: bpToPercent(r.esicEmployeeBp),
    esicEmployer: bpToPercent(r.esicEmployerBp),
    esicCeiling: paiseToBox(r.esicWageCeilingPaise),
    esicExempt: paiseToBox(r.esicEmployeeExemptDailyPaise),
    ptState: r.ptState,
    slabs: r.ptSlabs.map((s) => ({ from: paiseToBox(s.fromPaise), tax: paiseToBox(s.monthlyPaise) })),
    bonusEligible: paiseToBox(r.bonusEligibleCeilingPaise),
    bonusCalc: paiseToBox(r.bonusCalcCeilingPaise),
    bonusMin: bpToPercent(r.bonusMinBp),
    bonusMax: bpToPercent(r.bonusMaxBp),
    gratuityMin: String(r.gratuityMinYears),
    gratuityCeiling: paiseToBox(r.gratuityCeilingPaise),
    note,
  };
}

export type RatesError = "needNote" | "badNumber" | "needMonth" | "epsOverEpf" | "bonusRange" | "ptSlabs" | "outOfRange";

export function ratesInput(f: RatesForm): { ok: true; effectiveFrom: string; value: StatutoryRates; note: string } | { ok: false; error: RatesError } {
  if (!isMonthText(f.effectiveFrom)) return { ok: false, error: "needMonth" };
  const note = f.note.trim();
  if (note === "") return { ok: false, error: "needNote" };
  const bp = [f.epfEmployee, f.epsEmployer, f.edli, f.epfAdmin, f.esicEmployee, f.esicEmployer, f.bonusMin, f.bonusMax].map(percentToBp);
  const money = [f.epfCeiling, f.esicCeiling, f.esicExempt, f.bonusEligible, f.bonusCalc, f.gratuityCeiling].map(rupeesToPaise);
  const whole = [f.epsMaxAge, f.gratuityMin].map(wholeNumber);
  const slabs = f.slabs.map((s) => ({ fromPaise: rupeesToPaise(s.from), monthlyPaise: rupeesToPaise(s.tax) }));
  if (bp.some((v) => v === null) || money.some((v) => v === null) || whole.some((v) => v === null) || slabs.some((s) => s.fromPaise === null || s.monthlyPaise === null)) return { ok: false, error: "badNumber" };
  const [epfEmployeeBp, epsEmployerBp, edliBp, epfAdminBp, esicEmployeeBp, esicEmployerBp, bonusMinBp, bonusMaxBp] = bp as number[];
  const [epfWageCeilingPaise, esicWageCeilingPaise, esicEmployeeExemptDailyPaise, bonusEligibleCeilingPaise, bonusCalcCeilingPaise, gratuityCeilingPaise] = money as number[];
  const [epsMaxAge, gratuityMinYears] = whole as number[];
  const value: StatutoryRates = {
    epfEmployeeBp: epfEmployeeBp!,
    epsEmployerBp: epsEmployerBp!,
    epfWageCeilingPaise: epfWageCeilingPaise!,
    edliBp: edliBp!,
    epfAdminBp: epfAdminBp!,
    epsMaxAge: epsMaxAge!,
    esicEmployeeBp: esicEmployeeBp!,
    esicEmployerBp: esicEmployerBp!,
    esicWageCeilingPaise: esicWageCeilingPaise!,
    esicEmployeeExemptDailyPaise: esicEmployeeExemptDailyPaise!,
    ptState: f.ptState.trim().toUpperCase(),
    ptSlabs: slabs.map((s) => ({ fromPaise: s.fromPaise!, monthlyPaise: s.monthlyPaise! })),
    bonusEligibleCeilingPaise: bonusEligibleCeilingPaise!,
    bonusCalcCeilingPaise: bonusCalcCeilingPaise!,
    bonusMinBp: bonusMinBp!,
    bonusMaxBp: bonusMaxBp!,
    gratuityMinYears: gratuityMinYears!,
    gratuityCeilingPaise: gratuityCeilingPaise!,
  };
  if (value.ptState.length < 2 || value.ptState.length > 4 || value.ptSlabs.length < 1 || value.ptSlabs.length > 12) return { ok: false, error: value.ptSlabs.length < 1 || value.ptSlabs.length > 12 ? "ptSlabs" : "badNumber" };
  if (value.epsMaxAge < 50 || value.epsMaxAge > 70 || value.gratuityMinYears < 1 || value.gratuityMinYears > 10) return { ok: false, error: "outOfRange" };
  const err = statutoryRatesError(value);
  if (err === "eps_over_epf") return { ok: false, error: "epsOverEpf" };
  if (err === "bonus_range") return { ok: false, error: "bonusRange" };
  if (err === "pt_slabs") return { ok: false, error: "ptSlabs" };
  if (err) return { ok: false, error: "outOfRange" };
  return { ok: true, effectiveFrom: f.effectiveFrom.trim(), value, note };
}

/** The saved rates in force for a month, or null when none is saved (the defaults apply). */
export function ratesInForce(history: SettingsGet["statutory"], month: string): { effectiveFrom: string; value: StatutoryRates; note: string | null } | null {
  const row = datedFor(history, month);
  return row ? { effectiveFrom: row.effectiveFrom, value: row.value as unknown as StatutoryRates, note: row.note } : null;
}

// ---------------------------------------------------------------------------
// Full and final
// ---------------------------------------------------------------------------

export type RecoveryBox = { label: string; amount: string };
export type SettlementError = "badDays" | "badAmount" | "needLabel";

export function settlementInput(f: { unpaid: string; encash: string; recoveries: readonly RecoveryBox[] }): { ok: true; unpaidHalves: number; encashHalves: number; recoveries: { label: string; paise: number }[] } | { ok: false; error: SettlementError } {
  const unpaid = f.unpaid.trim() === "" ? 0 : daysToHalves(f.unpaid);
  const encash = f.encash.trim() === "" ? 0 : daysToHalves(f.encash);
  if (unpaid === null || encash === null || unpaid > 124 || encash > 730) return { ok: false, error: "badDays" };
  const recoveries: { label: string; paise: number }[] = [];
  for (const r of f.recoveries) {
    if (r.label.trim() === "" && r.amount.trim() === "") continue;
    if (r.label.trim() === "") return { ok: false, error: "needLabel" };
    const paise = rupeesToPaise(r.amount);
    if (paise === null || paise <= 0) return { ok: false, error: "badAmount" };
    recoveries.push({ label: r.label.trim().slice(0, 60), paise });
  }
  return { ok: true, unpaidHalves: unpaid, encashHalves: encash, recoveries };
}

/** The recoveries of a worked-out statement as boxes again (the lines the server stored carry a negative amount). */
export function recoveryBoxes(lines: readonly { code: string; label?: string; paise: number }[]): RecoveryBox[] {
  return lines.filter((l) => l.code === "recovery").map((l) => ({ label: l.label ?? "", amount: paiseToBox(Math.abs(l.paise)) }));
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** "A1, A2, A3 and 4 more" is not worth the words: the codes, as many as there are, comma separated. */
export function codesText(codes: readonly string[]): string {
  return codes.join(", ");
}
