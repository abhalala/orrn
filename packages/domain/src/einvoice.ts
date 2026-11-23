/**
 * XE-BILL row 15: e-invoice (IRN) and e-way bill rules, and the GSTN INV-01 payload pipeline
 * (validate -> totals -> sanitise to the NIC patterns -> map to the government keys). Built, not live: the
 * payload goes to the GST relay (`apps/gst-relay`), never from the Worker to a government endpoint.
 *
 * Rules (memory note india-gst-api-access-facts, CBIC Rule 138):
 * - IRN cancel only within 24 h of the acknowledgement, and never while an e-way bill is active.
 * - E-way bill needed when the consignment value is more than Rs 50,000 (value includes tax).
 * - Validity: 1 day per 200 km or part (normal cargo); a "day" ends at midnight IST of the day after
 *   generation, so 1 day from 10:00 on the 1st runs to the end of the 2nd.
 * - Extension only within 8 h before or after expiry. A document older than 180 days gets no e-way bill.
 * - The IRP stops serving IRN details after 2 days, so the signed invoice and QR are stored on first success.
 */
import { FOREIGN_STATE_CODE, isPincode, isStateCode, isValidGstin, type SupplyType } from "./gst";
import type { InvoiceTotals } from "./gstInvoice";

export const IRN_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const EWB_THRESHOLD_PAISE = 50_000 * 100;
export const EWB_KM_PER_DAY = 200;
export const EWB_EXTEND_WINDOW_MS = 8 * 60 * 60 * 1000;
export const EWB_MAX_DOC_AGE_DAYS = 180;
/** IST is UTC+05:30 with no daylight saving; e-way bill days are IST days by law. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** IRN retry: 5 minutes apart, at most 6 tries, then failed (the office can retry by hand). */
export const IRN_RETRY_EVERY_MS = 5 * 60 * 1000;
export const IRN_MAX_AUTO_TRIES = 6;

export function irnCancelRefusal(input: { ackAt: number | null; now: number; ewbActive: boolean }): "no_irn" | "window" | "ewb_active" | null {
  if (input.ackAt == null) return "no_irn";
  if (input.ewbActive) return "ewb_active";
  if (input.now - input.ackAt > IRN_CANCEL_WINDOW_MS) return "window";
  return null;
}

/** More than Rs 50,000 (exactly 50,000 needs none). */
export function ewbRequired(consignmentValuePaise: number): boolean {
  return consignmentValuePaise > EWB_THRESHOLD_PAISE;
}

export function ewbValidityDays(distanceKm: number): number {
  if (!Number.isInteger(distanceKm) || distanceKm < 0) throw new RangeError("Distance must be a whole number of km");
  return Math.max(1, Math.ceil(distanceKm / EWB_KM_PER_DAY));
}

/** The last instant (ms) an e-way bill generated at `generatedAt` is valid: 23:59:59.999 IST of day + days. */
export function ewbValidUntil(generatedAt: number, distanceKm: number): number {
  const days = ewbValidityDays(distanceKm);
  const istDayStart = Math.floor((generatedAt + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return istDayStart + (days + 1) * DAY_MS - 1;
}

export function ewbCanExtend(validUntil: number, now: number): boolean {
  return Math.abs(now - validUntil) <= EWB_EXTEND_WINDOW_MS;
}

/** Days from the document date (YYYY-MM-DD) to today (YYYY-MM-DD), whole days. */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const at = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  return Math.round((at(toYmd) - at(fromYmd)) / DAY_MS);
}

export function ewbDocTooOld(docYmd: string, todayYmd: string): boolean {
  return daysBetweenYmd(docYmd, todayYmd) > EWB_MAX_DOC_AGE_DAYS;
}

// ---------------------------------------------------------------------------
// Signed invoice (JWT) decoding: DUPIRN recovery
// ---------------------------------------------------------------------------

function base64UrlDecode(part: string): string {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export type SignedInvoiceFacts = { irn: string; ackNo: string; ackDt: string; docNo: string | null };

/**
 * Read Irn, AckNo and AckDt out of a SignedInvoice JWT (the IRP signs a payload whose `data` claim is the
 * invoice JSON as a string). Used when the IRP answers 2150 (duplicate IRN): the invoice already has an IRN,
 * so it is fetched by document and these facts are taken from its signature. The signature itself is the
 * IRP's; orrn does not verify it (the relay fetched it over TLS from the IRP). Null when unreadable.
 */
export function decodeSignedInvoice(jwt: string): SignedInvoiceFacts | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const claims = JSON.parse(base64UrlDecode(parts[1]!)) as { data?: unknown };
    const data = typeof claims.data === "string" ? (JSON.parse(claims.data) as Record<string, unknown>) : (claims.data as Record<string, unknown>);
    if (!data || typeof data !== "object") return null;
    const irn = data.Irn;
    const ackNo = data.AckNo;
    const ackDt = data.AckDt;
    if (typeof irn !== "string" || irn.length !== 64) return null;
    if (ackNo == null || typeof ackDt !== "string") return null;
    const doc = (data.DocDtls ?? null) as { No?: unknown } | null;
    return { irn, ackNo: String(ackNo), ackDt, docNo: typeof doc?.No === "string" ? doc.No : null };
  } catch {
    return null;
  }
}

/** "2026-10-03 12:34:56" (the IRP's AckDt, IST) to epoch ms. Null when not that shape. */
export function parseAckDt(ackDt: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(ackDt.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [number, number, number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_MS;
}

// ---------------------------------------------------------------------------
// INV-01 payload pipeline
// ---------------------------------------------------------------------------

/** NIC document number pattern: 1 to 16 characters, first not 0, / or -; capitals, digits, / and -. */
export const NIC_DOC_NO = /^([A-Z1-9]{1}[A-Z0-9/-]{0,15})$/;

export type EinvoiceParty = {
  gstin: string | null;
  legalName: string;
  tradeName?: string | null;
  address1: string;
  address2?: string | null;
  place: string;
  pincode: string;
  stateCode: string;
  phone?: string | null;
  email?: string | null;
};

export type EinvoiceModel = {
  kind: "invoice" | "credit_note";
  number: string;
  /** YYYY-MM-DD */
  date: string;
  supplyType: SupplyType;
  placeOfSupply: string;
  seller: EinvoiceParty;
  buyer: EinvoiceParty;
  /** Only when goods go elsewhere than the buyer's address. */
  shipTo: EinvoiceParty | null;
  totals: InvoiceTotals;
  /** Credit note: the original invoice. */
  against?: { number: string; date: string } | null;
};

export type EinvoiceProblem = { field: string; problem: string };

export const EINVOICE_SUPPLY_CODES: Record<SupplyType, string> = {
  intra: "B2B",
  inter: "B2B",
  sez_wp: "SEZWP",
  sez_wop: "SEZWOP",
  exp_wp: "EXPWP",
  exp_wop: "EXPWOP",
};

const isExport = (s: SupplyType) => s === "exp_wp" || s === "exp_wop";

/** Stage 1: what would make the IRP refuse the invoice, checked locally first. */
export function validateEinvoice(m: EinvoiceModel): EinvoiceProblem[] {
  const out: EinvoiceProblem[] = [];
  if (!NIC_DOC_NO.test(m.number)) out.push({ field: "DocDtls.No", problem: "pattern" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) out.push({ field: "DocDtls.Dt", problem: "date" });
  if (!isValidGstin(m.seller.gstin)) out.push({ field: "SellerDtls.Gstin", problem: "gstin" });
  if (!isStateCode(m.seller.stateCode) || m.seller.stateCode !== m.seller.gstin?.slice(0, 2)) {
    out.push({ field: "SellerDtls.Stcd", problem: "state" });
  }
  if (!isPincode(m.seller.pincode)) out.push({ field: "SellerDtls.Pin", problem: "pincode" });
  if (isExport(m.supplyType)) {
    if (m.placeOfSupply !== FOREIGN_STATE_CODE) out.push({ field: "BuyerDtls.Pos", problem: "export_pos" });
  } else {
    if (!isValidGstin(m.buyer.gstin)) out.push({ field: "BuyerDtls.Gstin", problem: "gstin" });
    if (!isPincode(m.buyer.pincode)) out.push({ field: "BuyerDtls.Pin", problem: "pincode" });
    if (!isStateCode(m.placeOfSupply)) out.push({ field: "BuyerDtls.Pos", problem: "state" });
  }
  if (m.totals.lines.length === 0) out.push({ field: "ItemList", problem: "empty" });
  if (m.totals.lines.length > 1000) out.push({ field: "ItemList", problem: "too_many" });
  m.totals.lines.forEach((l, i) => {
    if (!/^([0-9]{4}|[0-9]{6}|[0-9]{8})$/.test(l.hsn)) out.push({ field: `ItemList[${i}].HsnCd`, problem: "hsn" });
  });
  if (m.kind === "credit_note" && !m.against) out.push({ field: "RefDtls", problem: "original_invoice" });
  return out;
}

/** Stage 3: text the NIC patterns accept. Keeps letters, digits, space and . , / ' & ( ) - # : @; trims to `max`. */
export function nicText(raw: string | null | undefined, max: number, min = 1): string | null {
  const cleaned = (raw ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 .,/'&()\-#:@]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return cleaned.length >= min ? cleaned : null;
}

const rupees = (paise: number) => Math.round(paise) / 100;
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

function party(p: EinvoiceParty, opts: { gstin: string; pos?: string }) {
  return {
    Gstin: opts.gstin,
    LglNm: nicText(p.legalName, 100, 3) ?? "NA",
    TrdNm: nicText(p.tradeName ?? null, 100, 3),
    ...(opts.pos ? { Pos: opts.pos } : {}),
    Addr1: nicText(p.address1, 100, 1) ?? "NA",
    Addr2: nicText(p.address2 ?? null, 100, 3),
    Loc: nicText(p.place, 50, 3) ?? "NA",
    Pin: Number(p.pincode),
    Stcd: p.stateCode,
    Ph: p.phone ? (p.phone.replace(/\D/g, "").slice(-12) || null) : null,
    Em: p.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email) ? p.email.slice(0, 100) : null,
  };
}

/** Drop null and undefined keys (the IRP schema refuses explicit nulls on several optional fields). */
function compact<T>(v: T): T {
  if (Array.isArray(v)) return v.map(compact) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [k, compact(x)])) as T;
  }
  return v;
}

export type Inv01Result = { ok: true; payload: Record<string, unknown> } | { ok: false; problems: EinvoiceProblem[] };

/** The full pipeline: validate, (totals already computed by `computeInvoice`), sanitise, map to INV-01 v1.1. */
export function buildInv01(m: EinvoiceModel): Inv01Result {
  const problems = validateEinvoice(m);
  if (problems.length > 0) return { ok: false, problems };
  const exp = isExport(m.supplyType);
  const t = m.totals;
  const payload = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: EINVOICE_SUPPLY_CODES[m.supplyType], RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: m.kind === "credit_note" ? "CRN" : "INV", No: m.number, Dt: dmy(m.date) },
    SellerDtls: party(m.seller, { gstin: m.seller.gstin! }),
    BuyerDtls: exp
      ? { ...party({ ...m.buyer, pincode: "999999" }, { gstin: "URP", pos: FOREIGN_STATE_CODE }), Stcd: FOREIGN_STATE_CODE }
      : party(m.buyer, { gstin: m.buyer.gstin!, pos: m.placeOfSupply }),
    ...(m.shipTo
      ? { ShipDtls: party(m.shipTo, { gstin: m.shipTo.gstin && isValidGstin(m.shipTo.gstin) ? m.shipTo.gstin : "URP" }) }
      : {}),
    ItemList: t.lines.map((l, i) => {
      const qty = l.weightG != null ? l.weightG / 1000 : 1;
      const unitPrice = l.ratePaise != null ? l.ratePaise / 100 : rupees(l.taxablePaise);
      return {
        SlNo: String(i + 1),
        PrdDesc: nicText(l.description, 300, 3) ?? "Aluminium section",
        IsServc: "N",
        HsnCd: l.hsn,
        Qty: qty,
        FreeQty: 0,
        Unit: l.uqc,
        UnitPrice: unitPrice,
        TotAmt: rupees(l.taxablePaise),
        Discount: 0,
        PreTaxVal: 0,
        AssAmt: rupees(l.taxablePaise),
        GstRt: l.gstRateBp / 100,
        IgstAmt: rupees(l.igstPaise),
        CgstAmt: rupees(l.cgstPaise),
        SgstAmt: rupees(l.sgstPaise),
        CesRt: 0,
        CesAmt: 0,
        CesNonAdvlAmt: 0,
        StateCesRt: 0,
        StateCesAmt: 0,
        StateCesNonAdvlAmt: 0,
        OthChrg: 0,
        TotItemVal: rupees(l.totalPaise),
      };
    }),
    ValDtls: {
      AssVal: rupees(t.taxablePaise),
      CgstVal: rupees(t.cgstPaise),
      SgstVal: rupees(t.sgstPaise),
      IgstVal: rupees(t.igstPaise),
      CesVal: 0,
      StCesVal: 0,
      Discount: 0,
      OthChrg: 0,
      RndOffAmt: rupees(t.roundOffPaise),
      TotInvVal: rupees(t.totalPaise),
    },
    ...(m.kind === "credit_note" && m.against
      ? { RefDtls: { PrecDocDtls: [{ InvNo: m.against.number, InvDt: dmy(m.against.date) }] } }
      : {}),
    ...(exp ? { ExpDtls: { CntCode: null, ForCur: null } } : {}),
  };
  return { ok: true, payload: compact(payload) };
}

// ---------------------------------------------------------------------------
// Offline e-way bill (bulk JSON upload on the EWB portal): works without any API credentials
// ---------------------------------------------------------------------------

export type EwbOfflineInput = {
  invoiceNumber: string;
  invoiceDate: string;
  supplyType: SupplyType;
  seller: EinvoiceParty;
  buyer: EinvoiceParty;
  shipTo: EinvoiceParty | null;
  totals: InvoiceTotals;
  distanceKm: number;
  vehicleNo: string | null;
  transporterName: string | null;
  transporterId: string | null;
};

/**
 * One bill in the NIC e-way bill "bulk generation" JSON (the portal's offline upload, version 1.0.0621).
 * Supply type O (outward), sub type 1 (supply), document INV. Transport mode 1 (road) with Part-B when a
 * vehicle number is known; without one the portal makes Part-A only.
 */
export function ewbOfflineBill(input: EwbOfflineInput): Record<string, unknown> {
  const t = input.totals;
  const to = input.shipTo ?? input.buyer;
  const exp = isExport(input.supplyType);
  return compact({
    userGstin: input.seller.gstin,
    supplyType: "O",
    subSupplyType: exp ? 3 : 1,
    docType: "INV",
    docNo: input.invoiceNumber,
    docDate: dmy(input.invoiceDate),
    transType: input.shipTo ? 2 : 1,
    fromGstin: input.seller.gstin,
    fromTrdName: nicText(input.seller.legalName, 100, 3),
    fromAddr1: nicText(input.seller.address1, 120),
    fromPlace: nicText(input.seller.place, 50),
    fromPincode: Number(input.seller.pincode),
    fromStateCode: Number(input.seller.stateCode),
    actualFromStateCode: Number(input.seller.stateCode),
    toGstin: exp ? "URP" : input.buyer.gstin,
    toTrdName: nicText(input.buyer.legalName, 100, 3),
    toAddr1: nicText(to.address1, 120),
    toPlace: nicText(to.place, 50),
    toPincode: Number(to.pincode),
    toStateCode: exp ? 99 : Number(input.buyer.stateCode),
    actualToStateCode: exp ? 99 : Number(to.stateCode),
    totalValue: rupees(t.taxablePaise),
    cgstValue: rupees(t.cgstPaise),
    sgstValue: rupees(t.sgstPaise),
    igstValue: rupees(t.igstPaise),
    cessValue: 0,
    totInvValue: rupees(t.totalPaise),
    transMode: input.vehicleNo ? 1 : null,
    transDistance: input.distanceKm,
    transporterName: nicText(input.transporterName, 100),
    transporterId: input.transporterId,
    vehicleNo: input.vehicleNo,
    vehicleType: input.vehicleNo ? "R" : null,
    itemList: t.lines.map((l, i) => ({
      itemNo: i + 1,
      productName: nicText(l.description, 100, 1) ?? "Aluminium section",
      productDesc: nicText(l.description, 100, 1) ?? "Aluminium section",
      hsnCode: Number(l.hsn),
      quantity: l.weightG != null ? l.weightG / 1000 : 1,
      qtyUnit: l.uqc,
      taxableAmount: rupees(l.taxablePaise),
      sgstRate: l.sgstPaise > 0 ? l.gstRateBp / 200 : 0,
      cgstRate: l.cgstPaise > 0 ? l.gstRateBp / 200 : 0,
      igstRate: l.igstPaise > 0 ? l.gstRateBp / 100 : 0,
      cessRate: 0,
    })),
  });
}

export function ewbOfflineFile(bills: Record<string, unknown>[]): { version: string; billLists: Record<string, unknown>[] } {
  return { version: "1.0.0621", billLists: bills };
}
