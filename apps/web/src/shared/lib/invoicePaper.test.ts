import { amountInWords, computeInvoice } from "@orrn/domain";
import type { InvoiceSnapshot } from "@orrn/server/lib/billing/snapshot";
import { describe, expect, test } from "bun:test";

import { BANK_NOT_SET, dmy, invoicePaperModel, invoicePdfFileName, paperTitle, statementPaperModel, statementPdfFileName, type PaperDoc } from "./invoicePaper";
import { buildInvoicePdfBlob } from "./invoicePdf";

function snapshot(supply: "intra" | "inter" = "intra"): InvoiceSnapshot {
  const totals = computeInvoice(
    [
      { key: "a", description: "Section 12170, 6063 T5", hsn: "7604", uqc: "KGS", gstRateBp: 1800, kind: "weight", weightG: 1_250_500, ratePaise: 21_550 },
      { key: "b", description: "Powder coating", hsn: "7604", uqc: "KGS", gstRateBp: 1800, kind: "charge", amountPaise: 500_000 },
    ],
    supply,
  );
  return {
    version: 1,
    input: { packingListIds: ["p1"], rates: {}, charges: [] },
    plant: { name: "FourCubes", legalName: "FourCubes Industries LLP", tradeName: null, gstin: "24ABCDE1234F1Z5", stateCode: "24", address: "Plot 4, GIDC", place: "Surat", pincode: "394210", phone: "0261 111", signatory: "A. Shah", terms: "Interest at 18% on late payment" },
    party: {
      customerId: "c1", name: "Shivam Aluminium", category: "regular", gstin: "24AAAAA0000A1Z5", stateCode: "24", stateName: "Gujarat", address: "Shop 9, Ring Road", place: "Surat", pincode: "395002", phone: null, email: null, placeOfSupply: "24",
      shipTo: { kind: "address", gstin: null, legalName: "Shivam Godown", address1: "Godown 2", place: "Kadodara", pincode: "394327", stateCode: "24" }, distanceKm: 20,
    },
    supplyType: supply,
    placeOfSupply: supply === "intra" ? "24" : "27",
    totals,
    refs: [],
    sources: [{ plCode: "PL-26I0042", plRevision: 1, dispatchCodes: ["DSP-000090"] }],
    poNumbers: ["PO-77"],
    vehicleNo: "GJ05AB1234",
    amountInWords: amountInWords(totals.totalPaise),
    against: null,
  } as unknown as InvoiceSnapshot;
}

const irnNone = { irn: null, ackNo: null, ackDt: null, signedQrCode: null };
function doc(over: Partial<PaperDoc> = {}): PaperDoc {
  return { kind: "invoice", status: "issued", number: "FC/26-27/0007", invoiceDate: "2026-11-22", noteReason: null, reason: null, snapshot: snapshot(), irn: irnNone, ...over };
}

describe("invoice paper", () => {
  test("an issued invoice is a Tax Invoice with the whole header", () => {
    const p = invoicePaperModel(doc());
    expect(p.title).toBe("Tax Invoice");
    expect(p.mark).toBeNull();
    expect(p.seller).toMatchObject({ legalName: "FourCubes Industries LLP", gstin: "24ABCDE1234F1Z5", state: "Gujarat (24)" });
    expect(p.meta).toEqual(
      expect.arrayContaining([
        { label: "Invoice no", value: "FC/26-27/0007" },
        { label: "Date", value: "22-11-2026" },
        { label: "Place of supply", value: "Gujarat (24)" },
        { label: "Packing list", value: "PL-26I0042" },
        { label: "PO no", value: "PO-77" },
        { label: "Vehicle", value: "GJ05AB1234" },
      ]),
    );
    expect(p.parties.map((x) => [x.label, x.name, x.gstin])).toEqual([
      ["Bill to", "Shivam Aluminium", "24AAAAA0000A1Z5"],
      ["Ship to", "Shivam Godown", ""],
    ]);
    expect(p.columns).toEqual(["Sr", "Description", "HSN", "Qty", "Rate per kg", "GST", "Taxable"]);
    expect(p.rows[0]).toEqual(["1", "Section 12170, 6063 T5", "7604", "1,250.500 kg", "215.50", "18%", "2,69,482.75"]);
    expect(p.rows[1]![3]).toBe("");
  });

  test("intra state prints CGST and SGST, inter state prints IGST, and the figures are the snapshot's", () => {
    const intra = invoicePaperModel(doc());
    expect(intra.tax.map((t) => t.label)).toEqual(["Taxable value", "CGST", "SGST"]);
    expect(intra.hsnColumns[3]).toBe("CGST + SGST");
    const inter = invoicePaperModel(doc({ snapshot: snapshot("inter") }));
    expect(inter.tax.map((t) => t.label)).toEqual(["Taxable value", "IGST"]);
    expect(inter.hsnColumns[3]).toBe("IGST");
    const s = snapshot();
    expect(intra.total).toBe(new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2 }).format(s.totals.totalPaise / 100));
    expect(intra.words).toBe(s.amountInWords);
    expect(intra.hsnRows).toHaveLength(s.totals.hsnSummary.length);
  });

  test("bank details are not set yet, the signature lines are there", () => {
    const p = invoicePaperModel(doc());
    expect(p.bank).toBe(BANK_NOT_SET);
    expect(p.bank).toBe("bank details not set");
    expect(p.forLine).toBe("For FourCubes Industries LLP");
    expect(p.signatory).toBe("A. Shah");
    expect(p.terms).toBe("Interest at 18% on late payment");
  });

  test("PROD-GATE: the plant's default bank from the invoice payload prints on the paper", () => {
    const p = invoicePaperModel({ ...doc(), bank: { bankName: "HDFC Bank", branch: "Naroda", accountName: "FourCubes Industries LLP", accountNo: "50200012345678", ifsc: "HDFC0001234" } });
    expect(p.bank).toBe("HDFC Bank, Naroda, FourCubes Industries LLP, A/c 50200012345678, IFSC HDFC0001234");
    expect(invoicePaperModel({ ...doc(), bank: null }).bank).toBe(BANK_NOT_SET);
  });

  test("waiting for its IRN: a clear draft mark, never called a tax invoice", () => {
    for (const status of ["irn_pending", "draft"] as const) {
      const p = invoicePaperModel(doc({ status, number: null, invoiceDate: null }));
      expect(p.title).not.toMatch(/tax invoice/i);
      expect(p.mark).toBe(status === "irn_pending" ? "Draft, IRN pending" : "Draft");
    }
    expect(paperTitle({ kind: "credit_note", status: "irn_pending" })).toEqual({ title: "Draft credit note", mark: "Draft, IRN pending" });
    expect(paperTitle({ kind: "invoice", status: "cancelled" })).toEqual({ title: "Tax Invoice", mark: "Cancelled" });
  });

  test("a credit note names the invoice it is against and why", () => {
    const s = snapshot();
    s.against = { id: "i1", number: "FC/26-27/0003", date: "2026-11-01" };
    const p = invoicePaperModel(doc({ kind: "credit_note", number: "CN/26-27/0001", snapshot: s, noteReason: "return", reason: "two bundles bent" }));
    expect(p.title).toBe("Credit Note");
    expect(p.meta).toEqual(expect.arrayContaining([{ label: "Credit note no", value: "CN/26-27/0001" }, { label: "Against invoice", value: "FC/26-27/0003 dated 01-11-2026" }, { label: "Reason", value: "goods returned, two bundles bent" }]));
  });

  test("the IRN, its ack and the signed QR text print only when there", () => {
    expect(invoicePaperModel(doc()).ack).toEqual([]);
    const p = invoicePaperModel(doc({ irn: { irn: "a".repeat(64), ackNo: "112010000123", ackDt: "2026-11-22 10:15:00", signedQrCode: "eyJhbGciOi.payload.sig" } }));
    expect(p.ack.map((a) => a.label)).toEqual(["IRN", "Ack no", "Ack date"]);
    expect(p.signedQr).toBe("eyJhbGciOi.payload.sig");
  });

  test("an IRN recorded from the IRP portal (no signed QR, no ack date) prints the IRN and ack no only", () => {
    const p = invoicePaperModel(doc({ irn: { irn: "b".repeat(64), ackNo: "112610000000123", ackDt: null, signedQrCode: null } }));
    expect(p.ack.map((a) => a.label)).toEqual(["IRN", "Ack no"]);
    expect(p.signedQr).toBeNull();
  });

  test("a supply without tax says so", () => {
    const s = snapshot();
    s.supplyType = "sez_wop";
    const p = invoicePaperModel(doc({ snapshot: s }));
    expect(p.tax.map((t) => t.label)).toEqual(["Taxable value", "Tax"]);
  });

  test("file names and dates", () => {
    expect(invoicePdfFileName({ kind: "invoice", status: "issued", number: "FC/26-27/0007" })).toBe("invoice-FC-26-27-0007.pdf");
    expect(invoicePdfFileName({ kind: "invoice", status: "draft", number: null })).toBe("invoice-draft-draft.pdf");
    expect(invoicePdfFileName({ kind: "credit_note", status: "issued", number: "CN/1" })).toBe("credit-note-CN-1.pdf");
    expect(dmy("2026-04-01")).toBe("01-04-2026");
    expect(dmy(null)).toBe("");
  });

  test("the PDF renders to a real file", async () => {
    const blob = await buildInvoicePdfBlob(doc({ status: "irn_pending", number: null, invoiceDate: null }));
    expect(blob.size).toBeGreaterThan(1500);
    expect(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });
});

describe("statement paper", () => {
  const base = {
    customer: { name: "Shivam Aluminium", gstin: "24AAAAA0000A1Z5" },
    plant: { legalName: "FourCubes Industries LLP", gstin: "24ABCDE1234F1Z5", address: "Plot 4, GIDC" },
    from: "2026-04-01",
    to: "2026-11-22",
    openingPaise: 100_000,
    lines: [
      { date: "2026-05-02", kind: "invoice" as const, number: "FC/26-27/0001", debitPaise: 500_000, creditPaise: 0, balancePaise: 600_000 },
      { date: "2026-05-20", kind: "payment" as const, number: "PAY-1", debitPaise: 0, creditPaise: 700_000, balancePaise: -100_000 },
    ],
    debitPaise: 500_000,
    creditPaise: 700_000,
    closingPaise: -100_000,
  };
  test("rows, balances with their side, and the closing line", () => {
    const p = statementPaperModel(base);
    expect(p.period).toBe("01-04-2026 to 22-11-2026");
    expect(p.rows[0]).toEqual(["02-05-2026", "Invoice", "FC/26-27/0001", "5,000.00", "", "6,000.00 Dr"]);
    expect(p.rows[1]).toEqual(["20-05-2026", "Payment received", "PAY-1", "", "7,000.00", "1,000.00 Cr"]);
    expect(p.opening).toBe("1,000.00 Dr");
    expect(p.closing).toBe("1,000.00 Cr");
    expect(p.closingNote).toBe("Amount in your favour");
    expect(p.totals).toEqual(["5,000.00", "7,000.00"]);
  });
  test("owed and nothing-due notes; a file name", () => {
    expect(statementPaperModel({ ...base, closingPaise: 5 }).closingNote).toBe("Amount due from you");
    expect(statementPaperModel({ ...base, closingPaise: 0 }).closing).toBe("0.00");
    expect(statementPdfFileName("Shivam & Sons", "2026-11-22")).toBe("statement-Shivam-Sons-2026-11-22.pdf");
  });
});
