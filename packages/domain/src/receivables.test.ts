import { describe, expect, test } from "bun:test";

import {
  ageingBucket,
  ageInvoices,
  buildStatement,
  DEFAULT_TALLY_LEDGERS,
  readTallyLedgers,
  tallyEnvelope,
  tallyVoucherXml,
  xmlEscape,
  type TallyVoucher,
} from "./receivables";

describe("ageing buckets", () => {
  test("0-30, 31-60, 61-90, 90+ by days since the invoice date", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(ageingBucket)).toEqual([
      "d0_30", "d0_30", "d31_60", "d31_60", "d61_90", "d61_90", "d90_plus", "d90_plus",
    ]);
  });

  test("outstanding = total - paid - credited, summed per bucket; settled invoices drop out", () => {
    const asOf = "2026-10-31";
    const r = ageInvoices(
      [
        { id: "1", number: "INV/26-27/1", invoiceDate: "2026-10-01", totalPaise: 100_000, paidPaise: 40_000, creditedPaise: 0 }, // 30 days
        { id: "2", number: "INV/26-27/2", invoiceDate: "2026-09-30", totalPaise: 50_000, paidPaise: 0, creditedPaise: 10_000 }, // 31 days
        { id: "3", number: "INV/26-27/3", invoiceDate: "2026-07-01", totalPaise: 70_000, paidPaise: 0, creditedPaise: 0 }, // 122 days
        { id: "4", number: "INV/26-27/4", invoiceDate: "2026-08-15", totalPaise: 9_000, paidPaise: 9_000, creditedPaise: 0 }, // settled
      ],
      asOf,
    );
    expect(r).toEqual({ outstandingPaise: 170_000, buckets: { d0_30: 60_000, d31_60: 40_000, d61_90: 0, d90_plus: 70_000 } });
  });
});

describe("customer statement", () => {
  test("opening balance before the range, running balance inside it, invoices before credits on one day", () => {
    const s = buildStatement(
      [
        { date: "2026-09-20", kind: "invoice", number: "INV/26-27/1", debitPaise: 100_000, creditPaise: 0 },
        { date: "2026-09-25", kind: "payment", number: "PAY-1", debitPaise: 0, creditPaise: 30_000 },
        { date: "2026-10-05", kind: "payment", number: "PAY-2", debitPaise: 0, creditPaise: 20_000 },
        { date: "2026-10-05", kind: "invoice", number: "INV/26-27/2", debitPaise: 50_000, creditPaise: 0 },
        { date: "2026-10-10", kind: "credit_note", number: "CN/26-27/1", debitPaise: 0, creditPaise: 5_000 },
        { date: "2026-11-02", kind: "invoice", number: "INV/26-27/3", debitPaise: 9_999, creditPaise: 0 },
      ],
      "2026-10-01",
      "2026-10-31",
    );
    expect(s.openingPaise).toBe(70_000);
    expect(s.lines.map((l) => [l.number, l.balancePaise])).toEqual([
      ["INV/26-27/2", 120_000],
      ["PAY-2", 100_000],
      ["CN/26-27/1", 95_000],
    ]);
    expect(s).toMatchObject({ debitPaise: 50_000, creditPaise: 25_000, closingPaise: 95_000 });
  });
});

/** Every ledger amount of one voucher; Tally needs them to sum to zero. */
function amounts(xml: string): number[] {
  return [...xml.matchAll(/<ALLLEDGERENTRIES\.LIST>.*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Math.round(Number(m[1]) * 100));
}

describe("Tally XML", () => {
  const sale: TallyVoucher = {
    type: "Sales",
    number: "INV/26-27/7",
    date: "2026-10-03",
    party: "Buyer & Sons <Rajkot>",
    partyGstin: "24AAGCB7383J1Z4",
    placeOfSupply: "Gujarat",
    reference: "PL/2026-27/12",
    taxablePaise: 30_308_620,
    cgstPaise: 2_727_776,
    sgstPaise: 2_727_776,
    igstPaise: 0,
    roundOffPaise: 28,
    totalPaise: 35_764_200,
    narration: "PL/2026-27/12",
  };

  test("a sales voucher balances; party debit is negative, credits positive; text is escaped", () => {
    const xml = tallyVoucherXml(sale, DEFAULT_TALLY_LEDGERS);
    expect(amounts(xml)).toEqual([-35_764_200, 30_308_620, 2_727_776, 2_727_776, 28]);
    expect(amounts(xml).reduce((a, b) => a + b, 0)).toBe(0);
    expect(xml).toContain("<PARTYLEDGERNAME>Buyer &amp; Sons &lt;Rajkot&gt;</PARTYLEDGERNAME>");
    expect(xml).toContain("<DATE>20261003</DATE>");
    expect(xml).toContain("<BILLTYPE>New Ref</BILLTYPE>");
  });

  test("a round off down sits on the debit side with a positive amount", () => {
    const xml = tallyVoucherXml({ ...sale, roundOffPaise: -49, totalPaise: 35_764_100 + 0, cgstPaise: 2_727_776, sgstPaise: 2_727_753 }, DEFAULT_TALLY_LEDGERS);
    expect(amounts(xml).reduce((a, b) => a + b, 0)).toBe(0);
    expect(xml).toContain("<LEDGERNAME>Round Off</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>-0.49</AMOUNT>");
  });

  test("a credit note is the mirror; a receipt debits bank and credits the party bill-wise", () => {
    const cn = tallyVoucherXml({ ...sale, type: "Credit Note", number: "CN/26-27/1", reference: "INV/26-27/7" }, DEFAULT_TALLY_LEDGERS);
    expect(amounts(cn)).toEqual([35_764_200, -30_308_620, -2_727_776, -2_727_776, -28]);
    expect(cn).toContain("<BILLTYPE>Agst Ref</BILLTYPE>");
    const rc = tallyVoucherXml(
      { type: "Receipt", number: "PAY-3", date: "2026-10-20", party: "Buyer", mode: "neft", amountPaise: 1_000_000, against: [{ number: "INV/26-27/7", amountPaise: 600_000 }], narration: "UTR 123" },
      DEFAULT_TALLY_LEDGERS,
    );
    expect(amounts(rc)).toEqual([-1_000_000, 600_000, 400_000]);
    expect(rc).toContain("<LEDGERNAME>Bank</LEDGERNAME>");
    expect(rc).toContain("<BILLTYPE>On Account</BILLTYPE>");
    const cash = tallyVoucherXml({ type: "Receipt", number: "PAY-4", date: "2026-10-20", party: "Buyer", mode: "cash", amountPaise: 500, against: [], narration: "" }, DEFAULT_TALLY_LEDGERS);
    expect(cash).toContain("<LEDGERNAME>Cash</LEDGERNAME>");
    expect(amounts(cash).reduce((a, b) => a + b, 0)).toBe(0);
  });

  test("envelope, plant ledger names, XML escaping", () => {
    const ledgers = readTallyLedgers({ sales: "Sales @ 18%", cgst: "", igst: 7 });
    expect(ledgers).toMatchObject({ sales: "Sales @ 18%", cgst: "Output CGST", igst: "Output IGST" });
    const env = tallyEnvelope([sale], ledgers, "Test Extrusions LLP");
    expect(env.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(env).toContain("<SVCURRENTCOMPANY>Test Extrusions LLP</SVCURRENTCOMPANY>");
    expect(env).toContain("<LEDGERNAME>Sales @ 18%</LEDGERNAME>");
    expect(xmlEscape(`a"b'c\u0001`)).toBe("a&quot;b&apos;c");
  });
});
