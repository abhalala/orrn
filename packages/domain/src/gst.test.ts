/**
 * XE-BILL statutory pins. GSTIN vectors are GSTINs published by GSTN and on public tax invoices (not
 * produced by our own function). Every money figure below is worked by hand in the comment beside it.
 */
import { describe, expect, test } from "bun:test";

import {
  buildInv01,
  decodeSignedInvoice,
  ewbCanExtend,
  ewbDocTooOld,
  ewbOfflineBill,
  ewbRequired,
  ewbValidityDays,
  ewbValidUntil,
  irnCancelRefusal,
  nicText,
  parseAckDt,
  type EinvoiceModel,
} from "./einvoice";
import {
  gstinCheckDigit,
  gstinProblem,
  gstinState,
  isHsnCode,
  isRegularGstin,
  isValidGstin,
  pincodeFitsState,
  placeOfSupplyFor,
  supplyTypeFor,
  taxHeadsFor,
} from "./gst";
import { amountInWords, computeInvoice, divRoundHalfUp, indianNumberWords, kgQtyText, lineTaxablePaise, rupeesText, type InvoiceLineInput } from "./gstInvoice";

describe("GSTIN (mod-36 check digit)", () => {
  // Published: GSTN's own sample, and GSTINs printed on public invoices.
  const published = ["27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "07AAGFF2194N1Z1", "27AAACR5055K1Z7"];

  test("published GSTINs are valid and carry their state", () => {
    for (const g of published) expect({ g, ok: isValidGstin(g) }).toEqual({ g, ok: true });
    expect(gstinCheckDigit("27AAPFU0939F1Z")).toBe("V");
    expect(gstinState("27AAPFU0939F1ZV")).toBe("27");
    expect(gstinState(" 29aagcb7383j1z4 ")).toBe("29");
    expect(isRegularGstin("27AAPFU0939F1ZV")).toBe(true);
  });

  test("one wrong character fails the check digit; shape and state are checked first", () => {
    expect(gstinProblem("27AAPFU0939F1ZW")).toBe("check_digit");
    expect(gstinProblem("27AAPFU0939F2ZV")).toBe("check_digit");
    // The PL test fixtures use made-up GSTINs: shaped right, check digit wrong.
    expect(gstinProblem("24AAACF1234A1Z5")).toBe("check_digit");
    expect(gstinProblem("27AAPFU0939F1Z")).toBe("shape");
    expect(gstinProblem("")).toBe("empty");
    expect(gstinProblem(null)).toBe("empty");
    expect(gstinProblem("99AAPFU0939F1ZV")).toBe("state");
    expect(gstinProblem("96AAPFU0939F1ZV")).toBe("state");
  });
});

describe("state codes and pincodes", () => {
  test("pincode prefixes fit their state; overlaps are allowed both ways", () => {
    expect(pincodeFitsState("394210", "24")).toBe(true); // Surat
    expect(pincodeFitsState("400001", "27")).toBe(true); // Mumbai
    expect(pincodeFitsState("403001", "30")).toBe(true); // Panaji, Goa
    expect(pincodeFitsState("403001", "27")).toBe(true); // inside Maharashtra's 400-445 too
    expect(pincodeFitsState("110001", "07")).toBe(true); // Delhi
    expect(pincodeFitsState("110001", "24")).toBe(false);
    expect(pincodeFitsState("012345", "24")).toBe(false); // cannot start with 0
    expect(pincodeFitsState("39421", "24")).toBe(false);
    expect(pincodeFitsState("394210", "25")).toBe(false); // 25 is not a current state code
  });
  test("HSN is 4, 6 or 8 digits", () => {
    expect(["7604", "760410", "76041000"].every(isHsnCode)).toBe(true);
    expect(["760", "76041", "7604A", ""].some(isHsnCode)).toBe(false);
  });
});

describe("supply type and tax heads", () => {
  test("same state is intra (CGST + SGST); other states inter (IGST); SEZ and export follow the category", () => {
    expect(supplyTypeFor({ plantState: "24", placeOfSupply: "24", category: "regular" })).toBe("intra");
    expect(supplyTypeFor({ plantState: "24", placeOfSupply: "27", category: "regular" })).toBe("inter");
    expect(supplyTypeFor({ plantState: "24", placeOfSupply: "24", category: "unregistered" })).toBe("intra");
    expect(supplyTypeFor({ plantState: "24", placeOfSupply: "24", category: "sez_with_payment" })).toBe("sez_wp");
    expect(supplyTypeFor({ plantState: "24", placeOfSupply: "96", category: "export_without_payment" })).toBe("exp_wop");
    expect(taxHeadsFor("intra")).toBe("cgst_sgst");
    expect(taxHeadsFor("inter")).toBe("igst");
    expect(taxHeadsFor("sez_wp")).toBe("igst");
    expect(taxHeadsFor("exp_wp")).toBe("igst");
    expect(taxHeadsFor("sez_wop")).toBe("none");
    expect(taxHeadsFor("exp_wop")).toBe("none");
  });
  test("place of supply: bill-to state unless set; exports are 96", () => {
    expect(placeOfSupplyFor({ category: "regular", billToState: "27" })).toBe("27");
    expect(placeOfSupplyFor({ category: "regular", billToState: "27", explicit: "24" })).toBe("24");
    expect(placeOfSupplyFor({ category: "regular", billToState: "27", explicit: "xx" })).toBe("27");
    expect(placeOfSupplyFor({ category: "export_with_payment", billToState: "27" })).toBe("96");
  });
});

const weight = (key: string, weightG: number, ratePaise: number, gstRateBp = 1800): InvoiceLineInput => ({
  key,
  description: "Aluminium section",
  hsn: "7604",
  uqc: "KGS",
  gstRateBp,
  kind: "weight",
  weightG,
  ratePaise,
});
const charge = (key: string, amountPaise: number, gstRateBp = 1800): InvoiceLineInput => ({
  key,
  description: "Anodising",
  hsn: "7604",
  uqc: "OTH",
  gstRateBp,
  kind: "charge",
  amountPaise,
});

describe("invoice arithmetic (paise, progressive per-tax rounding)", () => {
  test("half up integer division", () => {
    expect(divRoundHalfUp(5, 10)).toBe(1);
    expect(divRoundHalfUp(4, 10)).toBe(0);
    expect(divRoundHalfUp(15, 10)).toBe(2);
    expect(divRoundHalfUp(25, 10)).toBe(3);
    expect(lineTaxablePaise(10, 50)).toBe(1); // 10 g at Rs 0.50/kg = 0.5 paise -> 1
    expect(lineTaxablePaise(9, 50)).toBe(0); // 0.45 paise -> 0
  });

  test("worked example 1: 1,234.567 kg at Rs 245.50/kg, 18 % within Gujarat", () => {
    // Taxable: 1234.567 x 245.50 = 303,086.1985 -> Rs 3,03,086.20 (30,308,620 paise).
    // CGST 9 %: 303,086.20 x 0.09 = 27,277.758 -> 27,277.76. SGST the same.
    // Exact total 3,03,086.20 + 54,555.52 = 3,57,641.72 -> rounded 3,57,642.00, round off +0.28.
    const t = computeInvoice([weight("a", 1_234_567, 24_550)], "intra");
    expect(t).toMatchObject({
      weightG: 1_234_567,
      taxablePaise: 30_308_620,
      cgstPaise: 2_727_776,
      sgstPaise: 2_727_776,
      igstPaise: 0,
      exactPaise: 35_764_172,
      roundOffPaise: 28,
      totalPaise: 35_764_200,
    });
    expect(amountInWords(t.totalPaise)).toBe("Rupees Three Lakh Fifty Seven Thousand Six Hundred Forty Two Only");
    expect(rupeesText(t.totalPaise)).toBe("3,57,642.00");
  });

  test("worked example 2: the same load to Maharashtra is IGST 18 %", () => {
    // IGST: 303,086.20 x 0.18 = 54,555.516 -> 54,555.52. Total exact 3,57,641.72 -> 3,57,642.00.
    const t = computeInvoice([weight("a", 1_234_567, 24_550)], "inter");
    expect(t).toMatchObject({ taxablePaise: 30_308_620, cgstPaise: 0, sgstPaise: 0, igstPaise: 5_455_552, roundOffPaise: 28, totalPaise: 35_764_200 });
  });

  test("worked example 3: progressive rounding keeps line tax adding up to the invoice head", () => {
    // Three lines of Rs 100.03. IGST per line exactly 18.0054 -> rounding each line gives 18.01 x 3 = 54.03,
    // but the invoice head is 300.09 x 0.18 = 54.0162 -> 54.02. Progressive: cumulative 18.0054 -> 18.01,
    // 36.0108 -> 36.01 (line 2 = 18.00), 54.0162 -> 54.02 (line 3 = 18.01).
    const igst = computeInvoice([charge("a", 10_003), charge("b", 10_003), charge("c", 10_003)], "inter");
    expect(igst.lines.map((l) => l.igstPaise)).toEqual([1801, 1800, 1801]);
    expect(igst.igstPaise).toBe(5402);
    // CGST 9 % per line exactly 9.0027: cumulative 9.0027 -> 9.00, 18.0054 -> 18.01, 27.0081 -> 27.01.
    const intra = computeInvoice([charge("a", 10_003), charge("b", 10_003), charge("c", 10_003)], "intra");
    expect(intra.lines.map((l) => l.cgstPaise)).toEqual([900, 901, 900]);
    expect(intra.cgstPaise).toBe(2701);
    expect(intra.sgstPaise).toBe(2701);
    expect(intra.lines.reduce((n, l) => n + l.totalPaise, 0)).toBe(intra.exactPaise);
  });

  test("worked example 4: two sections and an anodising charge, HSN summary per HSN and rate", () => {
    // 812.400 kg x Rs 240.00 = 1,94,976.00; 98.765 kg x Rs 262.35 = 25,910.9978 -> 25,911.00; anodising 4,500.00.
    // Taxable 2,25,387.00. IGST 18 % = 40,569.66. Exact 2,65,956.66 -> 2,65,957.00, round off +0.34.
    const t = computeInvoice(
      [weight("a", 812_400, 24_000), { ...weight("b", 98_765, 26_235), hsn: "7608" }, charge("c", 450_000)],
      "inter",
    );
    expect(t.lines.map((l) => l.taxablePaise)).toEqual([19_497_600, 2_591_100, 450_000]);
    expect(t).toMatchObject({ taxablePaise: 22_538_700, igstPaise: 4_056_966, roundOffPaise: 34, totalPaise: 26_595_700, weightG: 911_165 });
    expect(t.hsnSummary).toEqual([
      { hsn: "7604", gstRateBp: 1800, taxablePaise: 19_947_600, cgstPaise: 0, sgstPaise: 0, igstPaise: 3_590_568 },
      { hsn: "7608", gstRateBp: 1800, taxablePaise: 2_591_100, cgstPaise: 0, sgstPaise: 0, igstPaise: 466_398 },
    ]);
  });

  test("round off is half up to the rupee: .49 goes down, .50 goes up; zero-rated export has no tax", () => {
    expect(computeInvoice([charge("a", 100_049)], "exp_wop")).toMatchObject({ taxPaise: 0, roundOffPaise: -49, totalPaise: 100_000 });
    expect(computeInvoice([charge("a", 100_050)], "exp_wop")).toMatchObject({ roundOffPaise: 50, totalPaise: 100_100 });
    expect(() => computeInvoice([], "intra")).toThrow();
    expect(() => computeInvoice([charge("a", -1)], "intra")).toThrow();
  });
});

describe("amount in words and quantities", () => {
  test("Indian system: crore, lakh, thousand, paise", () => {
    expect(amountInWords(12_345_678_905)).toBe("Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine and Five Paise Only");
    expect(amountInWords(100)).toBe("Rupees One Only");
    expect(amountInWords(1_000_000_000)).toBe("Rupees One Crore Only");
    expect(amountInWords(99)).toBe("Rupees Zero and Ninety Nine Paise Only");
    expect(indianNumberWords(1_00_00_00_000)).toBe("One Hundred Crore");
    expect(indianNumberWords(1_011)).toBe("One Thousand Eleven");
  });
  test("kg to the gram with Indian grouping", () => {
    expect(kgQtyText(1_234_567)).toBe("1,234.567");
    expect(kgQtyText(12_345_678_005)).toBe("1,23,45,678.005");
    expect(kgQtyText(5)).toBe("0.005");
  });
});

describe("e-way bill and IRN rules", () => {
  test("threshold: more than Rs 50,000; exactly 50,000 needs none", () => {
    expect(ewbRequired(5_000_000)).toBe(false);
    expect(ewbRequired(5_000_001)).toBe(true);
  });
  test("validity: one day per 200 km or part, at least one", () => {
    expect([0, 1, 200, 201, 400, 401, 1000].map(ewbValidityDays)).toEqual([1, 1, 1, 2, 2, 3, 5]);
  });
  test("a day ends at midnight IST of the day after generation", () => {
    // 3 Oct 12:00 IST, 150 km (1 day): valid to 4 Oct 23:59:59.999 IST = 4 Oct 18:29:59.999 UTC.
    expect(new Date(ewbValidUntil(Date.parse("2026-10-03T06:30:00Z"), 150)).toISOString()).toBe("2026-10-04T18:29:59.999Z");
    // 4 Oct 00:30 IST (3 Oct 19:00 UTC), 450 km (3 days): valid to 7 Oct 23:59:59.999 IST.
    expect(new Date(ewbValidUntil(Date.parse("2026-10-03T19:00:00Z"), 450)).toISOString()).toBe("2026-10-07T18:29:59.999Z");
  });
  test("extension within 8 h either side of expiry; documents older than 180 days get none", () => {
    const end = Date.parse("2026-10-04T18:29:59.999Z");
    expect(ewbCanExtend(end, end - 8 * 3_600_000)).toBe(true);
    expect(ewbCanExtend(end, end - 8 * 3_600_000 - 1)).toBe(false);
    expect(ewbCanExtend(end, end + 8 * 3_600_000)).toBe(true);
    expect(ewbDocTooOld("2026-04-01", "2026-09-28")).toBe(false); // 180 days
    expect(ewbDocTooOld("2026-04-01", "2026-09-29")).toBe(true); // 181 days
  });
  test("IRN cancel: within 24 h of the acknowledgement and never with a live e-way bill", () => {
    const ack = Date.parse("2026-10-03T06:30:00Z");
    expect(irnCancelRefusal({ ackAt: ack, now: ack + 24 * 3_600_000, ewbActive: false })).toBeNull();
    expect(irnCancelRefusal({ ackAt: ack, now: ack + 24 * 3_600_000 + 1, ewbActive: false })).toBe("window");
    expect(irnCancelRefusal({ ackAt: ack, now: ack + 60_000, ewbActive: true })).toBe("ewb_active");
    expect(irnCancelRefusal({ ackAt: null, now: ack, ewbActive: false })).toBe("no_irn");
    expect(new Date(parseAckDt("2026-10-03 12:00:00")!).toISOString()).toBe("2026-10-03T06:30:00.000Z");
    expect(parseAckDt("03/10/2026")).toBeNull();
  });
});

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("signed invoice decoding (DUPIRN recovery)", () => {
  test("reads Irn, AckNo, AckDt and the document number from the JWT's data claim", () => {
    const irn = "a".repeat(64);
    const data = JSON.stringify({ Irn: irn, AckNo: 112010000000123, AckDt: "2026-10-03 12:00:00", DocDtls: { No: "INV/26-27/7" } });
    const jwt = `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify({ data, iss: "NIC" }))}.sig`;
    expect(decodeSignedInvoice(jwt)).toEqual({ irn, ackNo: "112010000000123", ackDt: "2026-10-03 12:00:00", docNo: "INV/26-27/7" });
    expect(decodeSignedInvoice("not.a.jwt")).toBeNull();
    expect(decodeSignedInvoice(`${b64url("{}")}.${b64url(JSON.stringify({ data: JSON.stringify({ Irn: "short" }) }))}.x`)).toBeNull();
  });
});

const SELLER = {
  gstin: "27AAPFU0939F1ZV",
  legalName: "Test Extrusions LLP",
  address1: "Plot 12, MIDC",
  place: "Pune",
  pincode: "411001",
  stateCode: "27",
};
const BUYER = { gstin: "29AAGCB7383J1Z4", legalName: "Buyer Windows Pvt Ltd", address1: "Peenya 2nd Stage", place: "Bengaluru", pincode: "560058", stateCode: "29" };

describe("INV-01 payload pipeline", () => {
  const totals = computeInvoice([weight("a", 1_234_567, 24_550)], "inter");
  const model: EinvoiceModel = {
    kind: "invoice",
    number: "INV/26-27/7",
    date: "2026-10-03",
    supplyType: "inter",
    placeOfSupply: "29",
    seller: SELLER,
    buyer: BUYER,
    shipTo: null,
    totals,
  };

  test("maps to the GSTN keys with rupee amounts and the dd/mm/yyyy date", () => {
    const r = buildInv01(model);
    expect(r.ok).toBe(true);
    const p = (r as { payload: Record<string, any> }).payload;
    expect(p.Version).toBe("1.1");
    expect(p.TranDtls).toEqual({ TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" });
    expect(p.DocDtls).toEqual({ Typ: "INV", No: "INV/26-27/7", Dt: "03/10/2026" });
    expect(p.BuyerDtls).toMatchObject({ Gstin: "29AAGCB7383J1Z4", Pos: "29", Pin: 560058, Stcd: "29" });
    expect(p.ItemList[0]).toMatchObject({ SlNo: "1", HsnCd: "7604", Qty: 1234.567, Unit: "KGS", UnitPrice: 245.5, AssAmt: 303086.2, GstRt: 18, IgstAmt: 54555.52, TotItemVal: 357641.72 });
    expect(p.ValDtls).toMatchObject({ AssVal: 303086.2, IgstVal: 54555.52, CgstVal: 0, RndOffAmt: 0.28, TotInvVal: 357642 });
    expect(p.ShipDtls).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain("null");
  });

  test("refuses locally what the IRP would refuse", () => {
    const bad = buildInv01({ ...model, number: "inv/1", buyer: { ...BUYER, gstin: "29AAGCB7383J1Z5" } });
    expect(bad.ok).toBe(false);
    expect((bad as { problems: { field: string }[] }).problems.map((p) => p.field)).toEqual(["DocDtls.No", "BuyerDtls.Gstin"]);
    expect(buildInv01({ ...model, number: "INV/2026-27/123456" }).ok).toBe(false); // 18 characters
    expect(buildInv01({ ...model, kind: "credit_note" }).ok).toBe(false); // no original invoice
  });

  test("credit note carries the original invoice; export uses URP and 96", () => {
    const cn = buildInv01({ ...model, kind: "credit_note", number: "CN/26-27/1", against: { number: "INV/26-27/7", date: "2026-10-03" } });
    const p = (cn as { payload: Record<string, any> }).payload;
    expect(p.DocDtls.Typ).toBe("CRN");
    expect(p.RefDtls).toEqual({ PrecDocDtls: [{ InvNo: "INV/26-27/7", InvDt: "03/10/2026" }] });
    const exp = buildInv01({ ...model, supplyType: "exp_wop", placeOfSupply: "96", totals: computeInvoice([weight("a", 1000, 30_000)], "exp_wop") });
    const e = (exp as { payload: Record<string, any> }).payload;
    expect(e.TranDtls.SupTyp).toBe("EXPWOP");
    expect(e.BuyerDtls).toMatchObject({ Gstin: "URP", Pos: "96", Stcd: "96", Pin: 999999 });
  });

  test("NIC text: odd characters become spaces, lengths are cut", () => {
    expect(nicText("A\u0001B ₹ & Co.", 100)).toBe("A B & Co.");
    expect(nicText("ab", 100, 3)).toBeNull();
    expect(nicText("x".repeat(120), 100)).toHaveLength(100);
  });

  test("offline e-way bill (bulk upload JSON) needs no credentials", () => {
    const bill = ewbOfflineBill({
      invoiceNumber: "INV/26-27/7",
      invoiceDate: "2026-10-03",
      supplyType: "inter",
      seller: SELLER,
      buyer: BUYER,
      shipTo: null,
      totals,
      distanceKm: 840,
      vehicleNo: "MH12AB1234",
      transporterName: null,
      transporterId: null,
    });
    expect(bill).toMatchObject({ supplyType: "O", docType: "INV", docNo: "INV/26-27/7", docDate: "03/10/2026", fromStateCode: 27, toStateCode: 29, totInvValue: 357642, igstValue: 54555.52, transDistance: 840, transMode: 1, vehicleNo: "MH12AB1234" });
    expect((bill.itemList as { igstRate: number }[])[0]!.igstRate).toBe(18);
  });
});
