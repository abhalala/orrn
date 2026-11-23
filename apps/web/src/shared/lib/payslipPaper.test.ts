import { describe, expect, test } from "bun:test";

import { rupeesText } from "@orrn/domain";
import { createI18n } from "@orrn/i18n";
import { en as enMessages } from "@orrn/i18n/en";
import { gu as guMessages } from "@orrn/i18n/gu";

import { slipFigures } from "@/features/payroll/fixtures";
import type { SettlementFigures } from "@/features/payroll/explain";

import { esc, paperHtml, payslipPaperModel, settlementPaperModel } from "./payslipPaper";

const en = createI18n("en").t;
const hi = createI18n("hi").t;
const gu = createI18n("gu").t;

const company = { name: "Four Cubes LLP", lines: ["Plot 4, Rajkot"] };

describe("the payslip paper", () => {
  const f = slipFigures({ basic: 20_000_00, overtimeMin: 90, deductions: [{ code: "advance", label: "Diwali", paise: 1_000_00 }] });

  test("rows carry every line, its explanation and the server's totals", () => {
    const p = payslipPaperModel(en, f, "en", company);
    expect(p.title).toBe("Payslip");
    expect(p.subtitle).toBe("Pay for November 2026");
    expect(p.facts.slice(0, 2)).toEqual([["Employee code", "E-001"], ["Name", "Ramesh Patel"]]);
    expect(p.facts).toContainEqual(["Joined on", "01-04-2024"]);
    expect(p.facts).toContainEqual(["Bank account", "XXXXXX1234"]);
    const [earn, ded, emp] = p.tables;
    expect(earn!.heading).toBe("Earnings");
    expect(ded!.rows.find((r) => r.name === "EPF")?.why).toContain("wage ceiling");
    expect(ded!.rows.find((r) => r.name === "Advance recovered: Diwali")?.amount).toBe("1,000.00");
    expect(emp!.heading).toContain("Paid by the employer");
    expect(p.total).toEqual({ label: "Net pay", amount: rupeesText(f.netPaise) });
  });

  test("the labels follow the viewer's language: Hindi and Gujarati", () => {
    const h = payslipPaperModel(hi, f, "hi", company);
    expect(h.title).toBe("वेतन पर्ची");
    expect(h.tables[0]!.heading).toBe("कमाई");
    const g = payslipPaperModel(gu, f, "gu", company);
    expect(g.title).not.toBe("Payslip");
    expect(/[઀-૿]/.test(g.title)).toBe(true);
    expect(/[઀-૿]/.test(g.subtitle)).toBe(true);
    expect(g.tables[1]!.rows.find((r) => /EPF/.test(r.name))?.why).toMatch(/[઀-૿]/);
  });

  test("every printed payslip key has a Gujarati string that is not the English one", () => {
    const flat = (tree: Record<string, unknown>, prefix = ""): [string, string][] =>
      Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : flat(v as Record<string, unknown>, `${prefix}${k}.`)));
    const enKeys = flat((enMessages as unknown as { payroll: { payslip: Record<string, unknown> } }).payroll.payslip, "payroll.payslip.");
    const guMap = new Map(flat((guMessages as unknown as { payroll: { payslip: Record<string, unknown> } }).payroll.payslip, "payroll.payslip."));
    const missing = enKeys.filter(([k]) => !guMap.has(k)).map(([k]) => k);
    expect(missing).toEqual([]);
    // The few that are the same word in both (an acronym) are allowed; a sentence is not.
    const same = enKeys.filter(([k, v]) => guMap.get(k) === v && v.split(" ").length > 2).map(([k]) => k);
    expect(same).toEqual([]);
  });

  test("the HTML escapes what a person typed and keeps the page language", () => {
    const evil = slipFigures({ name: "<img src=x onerror=alert(1)>", deductions: [{ code: "other", label: "a & <b>", paise: 100 }] });
    const html = paperHtml(payslipPaperModel(en, evil, "en", { name: "A & B <Co>" }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("& <b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("a &amp; &lt;b&gt;");
    expect(html).toContain("A &amp; B &lt;Co&gt;");
    expect(html).toContain('<html lang="en">');
    expect(paperHtml(payslipPaperModel(hi, f, "hi", company))).toContain('<html lang="hi">');
    expect(esc('"')).toBe("&quot;");
  });
});

describe("the full and final paper", () => {
  const fnf: SettlementFigures = {
    lines: [
      { code: "unpaid_salary", paise: 10_000_00 },
      { code: "gratuity", paise: 69_230_77 },
      { code: "recovery", label: "Advance", paise: -2_000_00 },
    ],
    earningsPaise: 79_230_77,
    recoveriesPaise: 2_000_00,
    netPaise: 77_230_77,
    gratuity: { eligible: true, years: 8, paise: 69_230_77, capped: false },
    service: { years: 7, months: 8, days: 2 },
    person: { code: "E-001", name: "Ramesh", joinedOn: "2018-03-01", leftOn: "2026-11-02", reason: "resigned" },
    inputs: { unpaidHalves: 5, encashHalves: 0 },
    fullBasicDaPaise: 30_000_00,
    encashDivisor: 26,
  };
  test("rows, signed recovery, formula in words, net", () => {
    const p = settlementPaperModel(en, fnf, { gratuityMinYears: 5, gratuityCeilingPaise: 20_00_000_00 }, "en", company);
    expect(p.title).toBe("Full and final statement");
    expect(p.facts).toContainEqual(["Left on", "02-11-2026"]);
    expect(p.facts).toContainEqual(["Service", "7 years, 8 months, 2 days"]);
    const rows = p.tables[0]!.rows;
    expect(rows.map((r) => r.amount)).toEqual(["10,000.00", "69,230.77", "-2,000.00"]);
    expect(rows[1]!.why).toBe("Last basic and DA of 30,000 x 15 / 26 x 8 years");
    expect(p.total).toEqual({ label: "Net payable", amount: "77,230.77" });
  });
  test("Gujarati labels", () => {
    const p = settlementPaperModel(gu, fnf, null, "gu", company);
    expect(/[઀-૿]/.test(p.title)).toBe(true);
    expect(/[઀-૿]/.test(p.tables[0]!.rows[1]!.name)).toBe(true);
  });
});
