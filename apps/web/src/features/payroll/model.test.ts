import { describe, expect, test } from "bun:test";

import { DEFAULT_STATUTORY_RATES } from "@orrn/domain";
import { createI18n } from "@orrn/i18n";

import { amountText, bpText, explainEpf, explainEsic, explainOvertime, explainPt, halvesText, monthName, rs, settlementView, slipView, type SettlementFigures } from "./explain";
import { slipFigures } from "./fixtures";
import {
  adjustmentInput,
  adjustmentTotals,
  bpToPercent,
  daysToHalves,
  emptyStructureForm,
  paiseToBox,
  percentToBp,
  ratesInput,
  ratesInForce,
  ratesToForm,
  recentMonths,
  recoveryBoxes,
  rupeesToPaise,
  runActions,
  runTotals,
  settlementInput,
  stateTone,
  structureInput,
} from "./model";

const en = createI18n("en").t;
const hi = createI18n("hi").t;

describe("run states", () => {
  test("a month with no run can be worked out and nothing else", () => {
    expect(runActions(null)).toEqual({ compute: true, check: false, reopen: false, lock: false, files: false, approvalLink: false });
  });
  test("draft: work out and check (when someone is in it); checked: reopen and the approval; approved: reopen, lock, files; locked: files only", () => {
    expect(runActions({ status: "draft", headcount: 3 })).toMatchObject({ compute: true, check: true, reopen: false, lock: false, files: false });
    expect(runActions({ status: "draft", headcount: 0 }).check).toBe(false);
    expect(runActions({ status: "checked", headcount: 3 })).toMatchObject({ compute: false, check: false, reopen: true, approvalLink: true, files: false });
    expect(runActions({ status: "approved", headcount: 3 })).toMatchObject({ reopen: true, lock: true, files: true, approvalLink: false });
    expect(runActions({ status: "locked", headcount: 3 })).toEqual({ compute: false, check: false, reopen: false, lock: false, files: true, approvalLink: false });
  });
  test("every state has a tone", () => {
    expect(["draft", "checked", "approved", "locked"].map((s) => stateTone(s as "draft"))).toEqual(["neutral", "amber", "blue", "green"]);
  });
});

describe("totals and months", () => {
  test("a run's totals count the people with unmarked days", () => {
    const a = slipFigures({ notMarked: 2 });
    const b = slipFigures({ name: "Other", extra: [{ code: "earning", paise: 500_00 }] });
    const t = runTotals([
      { grossPaise: a.grossPaise, netPaise: a.netPaise, figures: a },
      { grossPaise: b.grossPaise, netPaise: b.netPaise, figures: b },
    ]);
    expect(t.headcount).toBe(2);
    expect(t.grossPaise).toBe(a.grossPaise + b.grossPaise);
    expect(t.netPaise).toBe(a.netPaise + b.netPaise);
    expect(t.deductionsPaise).toBe(a.totalDeductionsPaise + b.totalDeductionsPaise);
    expect(t.unmarkedPeople).toBe(1);
  });
  test("recent months run backwards over a year end", () => {
    expect(recentMonths("2026-02-10", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
});

describe("boxes", () => {
  test("rupees, percents and days", () => {
    expect(rupeesToPaise("12,500.50")).toBe(1_250_050);
    expect(rupeesToPaise("1.234")).toBeNull();
    expect(paiseToBox(1_250_000)).toBe("12500");
    expect(percentToBp("8.33")).toBe(833);
    expect(percentToBp("12")).toBe(1200);
    expect(percentToBp("1.234")).toBeNull();
    expect(bpToPercent(50)).toBe("0.5");
    expect(daysToHalves("2.5")).toBe(5);
    expect(daysToHalves("3")).toBe(6);
    expect(daysToHalves("2.3")).toBeNull();
    expect(daysToHalves("x")).toBeNull();
  });
});

describe("the salary structure form", () => {
  const base = { ...emptyStructureForm("2026-11", "e1"), basic: "12000" };
  test("a good form becomes paise, with ESIC auto as null", () => {
    const r = structureInput({ ...base, da: "1,500", hra: "", esicCovered: "auto" });
    expect(r).toEqual({
      ok: true,
      input: { employeeId: "e1", effectiveFrom: "2026-11", basicPaise: 1_200_000, daPaise: 150_000, hraPaise: 0, otherPaise: 0, perDay: false, pfMember: true, pfOnActual: false, esicMember: true, esicCovered: null, ptApplies: true },
    });
  });
  test("ESIC yes and no, and no override when not a member", () => {
    expect(structureInput({ ...base, esicCovered: "yes" })).toMatchObject({ ok: true, input: { esicCovered: true } });
    expect(structureInput({ ...base, esicCovered: "no" })).toMatchObject({ ok: true, input: { esicCovered: false } });
    expect(structureInput({ ...base, esicMember: false, esicCovered: "yes" })).toMatchObject({ ok: true, input: { esicCovered: null } });
  });
  test("EPF on actual means nothing for a non member", () => {
    expect(structureInput({ ...base, pfMember: false, pfOnActual: true })).toMatchObject({ ok: true, input: { pfOnActual: false } });
  });
  test("refusals say which box", () => {
    expect(structureInput({ ...base, employeeId: "" })).toEqual({ ok: false, error: "needPerson" });
    expect(structureInput({ ...base, effectiveFrom: "2026-13" })).toEqual({ ok: false, error: "needMonth" });
    expect(structureInput({ ...base, basic: "" })).toEqual({ ok: false, error: "needBasic" });
    expect(structureInput({ ...base, basic: "0" })).toEqual({ ok: false, error: "needBasic" });
    expect(structureInput({ ...base, da: "abc" })).toEqual({ ok: false, error: "badAmount" });
  });
});

describe("deductions and extra pay", () => {
  test("an entry needs a person and a positive amount; the note is trimmed or null", () => {
    expect(adjustmentInput({ employeeId: "e1", kind: "tds", label: "  Q3 ", amount: "250" })).toEqual({ ok: true, input: { employeeId: "e1", kind: "tds", label: "Q3", amountPaise: 25_000 } });
    expect(adjustmentInput({ employeeId: "e1", kind: "advance", label: " ", amount: "250" })).toMatchObject({ ok: true, input: { label: null } });
    expect(adjustmentInput({ employeeId: "", kind: "advance", label: "", amount: "250" })).toEqual({ ok: false, error: "needPerson" });
    expect(adjustmentInput({ employeeId: "e1", kind: "advance", label: "", amount: "0" })).toEqual({ ok: false, error: "needAmount" });
  });
  test("totals split earnings from deductions", () => {
    expect(adjustmentTotals([{ kind: "advance", amountPaise: 100 }, { kind: "tds", amountPaise: 50 }, { kind: "earning", amountPaise: 70 }])).toEqual({ deductionsPaise: 150, earningsPaise: 70 });
  });
});

describe("the statutory rates form", () => {
  const form = ratesToForm(DEFAULT_STATUTORY_RATES, "2026-11", "CA letter 2026");
  test("the defaults go round the form and back unchanged", () => {
    const r = ratesInput(form);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(DEFAULT_STATUTORY_RATES);
  });
  test("a note is required", () => {
    expect(ratesInput({ ...form, note: "  " })).toEqual({ ok: false, error: "needNote" });
  });
  test("the domain's checks are said in the form's words", () => {
    expect(ratesInput({ ...form, epsEmployer: "13" })).toEqual({ ok: false, error: "epsOverEpf" });
    expect(ratesInput({ ...form, bonusMin: "25" })).toEqual({ ok: false, error: "bonusRange" });
    expect(ratesInput({ ...form, slabs: [] })).toEqual({ ok: false, error: "ptSlabs" });
    expect(ratesInput({ ...form, epfCeiling: "x" })).toEqual({ ok: false, error: "badNumber" });
    expect(ratesInput({ ...form, effectiveFrom: "nov" })).toEqual({ ok: false, error: "needMonth" });
    expect(ratesInput({ ...form, epsMaxAge: "40" })).toEqual({ ok: false, error: "outOfRange" });
  });
  test("the saved rates in force for a month are the latest at or before it", () => {
    const row = (effectiveFrom: string, epf: number) => ({ id: effectiveFrom, companyId: "c", kind: "statutory" as const, effectiveFrom, value: { ...DEFAULT_STATUTORY_RATES, epfEmployeeBp: epf }, note: "n", createdBy: null, createdAt: new Date() });
    const history = [row("2026-10", 1100), row("2025-04", 1200)];
    expect(ratesInForce(history, "2026-11")?.value.epfEmployeeBp).toBe(1100);
    expect(ratesInForce(history, "2026-01")?.value.epfEmployeeBp).toBe(1200);
    expect(ratesInForce(history, "2024-01")).toBeNull();
  });
});

describe("full and final inputs", () => {
  test("days become halves; empty means none; recoveries need a label and an amount", () => {
    expect(settlementInput({ unpaid: "2.5", encash: "", recoveries: [{ label: "Advance", amount: "500" }, { label: "", amount: "" }] })).toEqual({ ok: true, unpaidHalves: 5, encashHalves: 0, recoveries: [{ label: "Advance", paise: 50_000 }] });
    expect(settlementInput({ unpaid: "2.3", encash: "", recoveries: [] })).toEqual({ ok: false, error: "badDays" });
    expect(settlementInput({ unpaid: "", encash: "", recoveries: [{ label: "", amount: "5" }] })).toEqual({ ok: false, error: "needLabel" });
    expect(settlementInput({ unpaid: "", encash: "", recoveries: [{ label: "Tool", amount: "0" }] })).toEqual({ ok: false, error: "badAmount" });
    expect(settlementInput({ unpaid: "63", encash: "", recoveries: [] })).toEqual({ ok: false, error: "badDays" });
  });
  test("a worked out statement's recoveries come back as boxes", () => {
    expect(recoveryBoxes([{ code: "gratuity", paise: 5 }, { code: "recovery", label: "Advance", paise: -50_000 }])).toEqual([{ label: "Advance", amount: "500" }]);
  });
});

describe("the words of a payslip", () => {
  test("numbers in words: rupees, basis points, halves, months", () => {
    expect(rs(1_500_000)).toBe("15,000");
    expect(rs(1_500_050)).toBe("15,000.50");
    expect(amountText(-50_000)).toBe("-500.00");
    expect(bpText(1200)).toBe("12");
    expect(bpText(833)).toBe("8.33");
    expect(bpText(150)).toBe("1.5");
    expect(halvesText(5)).toBe("2.5");
    expect(monthName(en, "2026-11")).toBe("November 2026");
    expect(monthName(hi, "2026-11")).toBe("नवंबर 2026");
  });

  test("EPF under the ceiling is a plain percentage of basic and DA", () => {
    const f = slipFigures({ basic: 12_000_00 });
    expect(explainEpf(en, f.epf!)).toBe("EPF 12% of 12,000");
  });
  test("EPF over the ceiling says it is capped, and says so when the person is on actual", () => {
    const capped = slipFigures({ basic: 20_000_00 });
    expect(capped.epf!.capped).toBe(true);
    expect(explainEpf(en, capped.epf!)).toBe("EPF 12% of 15,000, the wage ceiling (basic and DA are 20,000)");
    const actual = slipFigures({ basic: 20_000_00, pfOnActual: true });
    expect(explainEpf(en, actual.epf!)).toBe("EPF 12% of 20,000, the full basic and DA, as chosen for this person");
  });
  test("ESIC covered, over the ceiling and low wage", () => {
    expect(explainEsic(en, slipFigures({ basic: 12_000_00 }).esic!)).toBe("ESIC on gross pay of 12,000");
    expect(explainEsic(en, slipFigures({ basic: 12_000_00, esicCovered: false }).esic!)).toBe("Not covered by ESIC: gross pay is over the ESIC ceiling");
  });
  test("professional tax and overtime", () => {
    const f = slipFigures({ basic: 13_000_00, overtimeMin: 150 });
    expect(explainPt(en, f.pt!, f.grossPaise)).toContain("Professional tax for GJ");
    expect(explainOvertime(en, f.overtime)).toMatch(/^Overtime of 2 h 30 min at \d+(\.\d+)? times the hourly pay of /);
  });

  test("the view names every line and explains the statutory ones; notes carry paid days", () => {
    const f = slipFigures({ basic: 12_000_00, deductions: [{ code: "advance", label: "Diwali", paise: 1_000_00 }, { code: "tds", paise: 200_00 }], extra: [{ code: "earning", label: "Festival", paise: 500_00 }], lopHalves: 4, notMarked: 2 });
    const v = slipView(en, f);
    expect(v.earnings.map((l) => l.name)).toContain("Extra pay: Festival");
    expect(v.deductions.map((l) => l.name)).toEqual(expect.arrayContaining(["EPF", "Advance recovered: Diwali", "Income tax (TDS)"]));
    expect(v.deductions.find((l) => l.name === "EPF")?.why).toContain("EPF 12% of");
    expect(v.deductions.find((l) => l.name === "Income tax (TDS)")?.why).toBeNull();
    expect(v.employer.length).toBeGreaterThan(0);
    expect(v.notes[0]).toBe(`${f.paidHalves / 2} of ${f.monthDays} days paid`);
    expect(v.notes).toContain("2 days without pay");
    expect(v.notes).toContain("2 working days were not marked and are counted as unpaid");
    expect(v.notes).toContain("Salary structure from April 2026");
    // The figures are the server's: the lines add up to the slip.
    expect(v.earnings.reduce((a, l) => a + l.paise, 0)).toBe(f.grossPaise);
    expect(v.deductions.reduce((a, l) => a + l.paise, 0)).toBe(f.totalDeductionsPaise);
  });

  test("a statutory line that took nothing is explained in the notes", () => {
    const f = slipFigures({ basic: 12_000_00, esicCovered: false });
    expect(f.deductions.some((d) => d.code === "esic")).toBe(false);
    expect(slipView(en, f).notes).toContain("Not covered by ESIC: gross pay is over the ESIC ceiling");
  });

  test("Hindi says the same figures in Hindi", () => {
    const f = slipFigures({ basic: 12_000_00 });
    const v = slipView(hi, f);
    expect(v.deductions.find((l) => l.name === "EPF")?.why).toBe("12,000 का 12% EPF");
  });

  const fnf: SettlementFigures = {
    lines: [
      { code: "unpaid_salary", paise: 10_000_00 },
      { code: "leave_encashment", paise: 4_615_38 },
      { code: "gratuity", paise: 69_230_77 },
      { code: "bonus_due", paise: 0 },
      { code: "recovery", label: "Advance", paise: -2_000_00 },
    ],
    earningsPaise: 83_846_15,
    recoveriesPaise: 2_000_00,
    netPaise: 81_846_15,
    gratuity: { eligible: true, years: 8, paise: 69_230_77, capped: false },
    service: { years: 7, months: 8, days: 2 },
    person: { code: "E-001", name: "Ramesh", joinedOn: "2018-03-01", leftOn: "2026-11-02", reason: "resigned" },
    inputs: { unpaidHalves: 5, encashHalves: 10 },
    fullBasicDaPaise: 30_000_00,
    encashDivisor: 26,
  };
  test("full and final names each line and gives the 15/26 formula in words", () => {
    const v = settlementView(en, fnf, { gratuityMinYears: 5, gratuityCeilingPaise: 20_00_000_00 });
    expect(v.lines.map((l) => l.name)).toEqual(["Salary not yet paid", "Leave encashment", "Gratuity", "Bonus due", "Recovery: Advance"]);
    expect(v.lines[0]!.why).toBe("Salary for 2.5 days not yet paid");
    expect(v.lines[1]!.why).toBe("5 leave days: basic and DA of 30,000 divided by 26 for each day");
    expect(v.lines[2]!.why).toBe("Last basic and DA of 30,000 x 15 / 26 x 8 years");
    expect(v.service).toBe("7 years, 8 months, 2 days");
    expect(v.netPaise).toBe(81_846_15);
  });
  test("gratuity says why it is nil, and when it is capped", () => {
    const rates = { gratuityMinYears: 5, gratuityCeilingPaise: 20_00_000_00 };
    const short = { ...fnf, gratuity: { eligible: false, years: 3, paise: 0, capped: false }, service: { years: 2, months: 9, days: 0 } };
    expect(settlementView(en, short, rates).lines[2]!.why).toBe("No gratuity: 5 full years of service are needed and 2 were served");
    expect(settlementView(en, short, null).lines[2]!.why).toBe("No gratuity: there are not enough years of service");
    const capped = { ...fnf, gratuity: { eligible: true, years: 30, paise: 20_00_000_00, capped: true } };
    expect(settlementView(en, capped, rates).lines[2]!.why).toContain("capped at 20,00,000");
  });
});
