import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { paperFormatter } from "@/shared/lib/paper-fmt";
import { paperT } from "@/shared/lib/fmt-text";

import { buildProformaPaper, buildQuotePaper, buildWorksOrderPaper, daysOverdue, enquiryBadge, filterQuoteRows, quoteShownStatus, readSnapshot, taxPercentText, worksOrderRows, type ProformaSnapshot, type QuoteGet, type WorksOrderGet } from "./docs-model";
import { buildPaperHtml } from "./paper-html";

const fmt = paperFormatter("en");
const t = paperT(createI18n("en").t);

const snapshot: ProformaSnapshot = {
  number: "PI-4",
  date: "2026-11-22",
  source: { kind: "order", id: "o1", number: "SO-9", date: "2026-11-20", poNumber: "PO77" },
  letterhead: { legalName: "Four Cubes", gstin: "24AAAAA0000A1Z5", address: "Surat", phone: null },
  customer: { name: "Shah Metals", gstin: null, billingAddress: "Vapi" },
  lines: [
    { lineNo: 1, sectionCode: "12170", sectionName: "Domal", alloy: "6063", temper: "T5", finish: null, cutLengthMm: 3658, pcs: 10, kgG: 100_000, ratePaise: 25_000, amountPaise: 2_500_000, breakup: { metalPaisePerKg: 19_000, conversionPaisePerKg: 5_000, alloyPaisePerKg: 0, finishPaisePerKg: 0, componentsPaisePerKg: 1_000, discountPaisePerKg: 0 } },
  ],
  charges: [{ label: "Packing", paise: 5_000 }],
  totals: { subtotalPaise: 2_500_000, gstBp: 1800, gstPaise: 450_000, totalPaise: 2_950_000 },
  bank: null,
};

describe("proforma paper", () => {
  const doc = buildProformaPaper(snapshot, fmt, t);
  test("says it is not a tax invoice and shows tax as an estimate at the plant percent", () => {
    expect(doc.banner).toBe("Proforma invoice. Not a tax invoice.");
    expect(doc.notes.join(" ")).toContain("estimate at 18 percent");
    expect(doc.totals[1]![0]).toContain("18 percent");
  });
  test("bank not set is printed while the snapshot has no bank", () => {
    expect(doc.notes).toContain("Bank details not set");
    const withBank = buildProformaPaper({ ...snapshot, bank: { name: "HDFC", account: "123" } }, fmt, t);
    expect(withBank.notes.join(" ")).toContain("HDFC, 123");
    expect(withBank.notes).not.toContain("Bank details not set");
  });
  test("each line has its rate breakdown and charges are listed, not added to the total", () => {
    expect(doc.details[0]![0]).toContain("metal 190.00");
    expect(doc.details[0]![0]).toContain("add-ons 10.00");
    expect(doc.notes.join(" ")).toContain("Packing");
    expect(doc.totals[2]![1]).toContain("29500.00");
  });
  test("html holds the banner and the rows", () => {
    const html = buildPaperHtml(doc);
    expect(html).toContain("Proforma invoice. Not a tax invoice.");
    expect(html).toContain("12170 Domal");
  });
  test("tax percent text and snapshot reading", () => {
    expect(taxPercentText(1800)).toBe("18");
    expect(taxPercentText(1250)).toBe("12.5");
    expect(readSnapshot(snapshot)?.number).toBe("PI-4");
    expect(readSnapshot({ nope: 1 })).toBeNull();
  });
});

describe("quote paper", () => {
  test("lines carry rate and amount and the valid until date", () => {
    const data = {
      quote: { number: "Q-3", quoteDate: "2026-11-22", validUntil: "2026-12-07", note: "Ex works" },
      customer: { name: "Shah Metals", billingAddress: null, taxId: null },
      letterhead: { legalName: "Four Cubes" },
      lines: [{ lineNo: 1, sectionCode: "12170", sectionName: null, alloy: "6063", temper: "T5", finish: "anodise", cutLengthMm: 3000, pcs: null, kgG: 50_000, ratePaise: 26_000, amountPaise: 1_300_000 }],
      totals: { totalPaise: 1_300_000 },
    } as unknown as QuoteGet;
    const doc = buildQuotePaper(data, fmt, t);
    expect(doc.rows[0]).toContain("260.00");
    expect(doc.meta.map((m) => m[0])).toContain("Valid until");
    expect(doc.notes[0]).toBe("Ex works");
  });
});

describe("works order", () => {
  const data = {
    order: { number: "SO-9", orderDate: "2026-11-20", expectedDate: "2026-12-05", poNumber: "PO77", note: null, customerName: "Shah Metals", status: "confirmed" },
    worksOrder: null,
    letterhead: null,
    lines: [{ lineNo: 1, sectionCode: "12170", sectionName: "Domal", alloy: "6063", temper: "T5", finish: "pvd", cutLengthMm: 3658, pcs: 10, kgG: 100_000, kgPer12ftMilli: 2_450, tierRank: 1, note: "urgent" }],
  } as unknown as WorksOrderGet;
  test("rows carry production facts and no price field", () => {
    const rows = worksOrderRows(data, fmt, t);
    expect(Object.keys(rows[0]!).sort()).toEqual(["alloy", "cutLength", "finish", "kg", "kgPer12ft", "lineNo", "note", "pcs", "section", "temper", "tier"]);
    expect(rows[0]!.kgPer12ft).toBe("2.450 kg/12ft");
    expect(rows[0]!.tier).toContain("1");
    const text = JSON.stringify(buildWorksOrderPaper(data, null, fmt, t));
    expect(text).not.toMatch(/rate|amount|paise|price/i);
  });
  test("an issued number heads the paper; before that it says so", () => {
    expect(buildWorksOrderPaper(data, "WO-2", fmt, t).meta[0]).toEqual(["Works order", "WO-2"]);
    expect(buildWorksOrderPaper(data, null, fmt, t).meta[0]![1]).toBe("Number not taken");
  });
});

describe("enquiry badge and quote rows", () => {
  test("overdue before today, due today, open after, closed when won or lost", () => {
    const today = "2026-11-22";
    expect(enquiryBadge({ status: "open", followUpDate: "2026-11-20" }, today)).toBe("overdue");
    expect(enquiryBadge({ status: "quoted", followUpDate: today }, today)).toBe("dueToday");
    expect(enquiryBadge({ status: "open", followUpDate: "2026-12-01" }, today)).toBe("open");
    expect(enquiryBadge({ status: "open", followUpDate: null }, today)).toBe("open");
    expect(enquiryBadge({ status: "won", followUpDate: "2026-11-01" }, today)).toBe("closed");
    expect(daysOverdue("2026-11-20", today)).toBe(2);
    expect(daysOverdue(today, today)).toBe(0);
  });
  test("expired shows over the stored status; filters narrow by text and date", () => {
    expect(quoteShownStatus({ status: "sent", expired: true })).toBe("expired");
    expect(quoteShownStatus({ status: "converted", expired: false })).toBe("converted");
    const rows = [
      { number: "Q-1", customerName: "Shah", quoteDate: "2026-11-01", validUntil: "", status: "draft", expired: false },
      { number: "Q-2", customerName: "Patel", quoteDate: "2026-11-15", validUntil: "", status: "draft", expired: false },
    ];
    expect(filterQuoteRows(rows, { text: "pat" }).map((r) => r.number)).toEqual(["Q-2"]);
    expect(filterQuoteRows(rows, { from: "2026-11-10" }).map((r) => r.number)).toEqual(["Q-2"]);
    expect(filterQuoteRows(rows, { to: "2026-11-10" }).map((r) => r.number)).toEqual(["Q-1"]);
  });
});
