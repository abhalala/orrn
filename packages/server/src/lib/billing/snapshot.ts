/**
 * XE-BILL: the frozen content of an invoice or credit note. Written on the draft, rewritten once at issue
 * from the then-current facts, never after: the print, the e-invoice payload, the e-way bill JSON and the
 * Tally voucher all read this snapshot, so a later change to a customer or to the plant's letterhead does
 * not change an issued document.
 */
import { amountInWords, computeInvoice, supplyTypeFor, taxHeadsFor, type EinvoiceModel, type EinvoiceParty, type InvoiceTotals, type SupplyType } from "@orrn/domain";

import type { ChargeInput, DraftSource, LineRef } from "./build";
import type { PartyGst, PlantGst } from "./facts";

export type CreditLineInput =
  | { kind: "weight"; description: string; hsnId?: string | null; weightG: number; ratePaise: number }
  | { kind: "amount"; description: string; hsnId?: string | null; amountPaise: number };

export type InvoiceSnapshot = {
  version: 1;
  /** What the draft was made from; issue rebuilds from it so the frozen lines are the current ones. */
  input: { packingListIds: string[]; rates: Record<string, number>; charges: ChargeInput[]; creditLines?: CreditLineInput[] };
  plant: Omit<PlantGst, "tallyLedgers" | "timezone" | "einvoiceFrom">;
  party: PartyGst;
  supplyType: SupplyType;
  placeOfSupply: string;
  totals: InvoiceTotals;
  refs: LineRef[];
  sources: Pick<DraftSource, "plCode" | "plRevision" | "dispatchCodes">[];
  poNumbers: string[];
  vehicleNo: string | null;
  amountInWords: string;
  against: { id: string; number: string; date: string } | null;
};

export function plantForSnapshot(p: PlantGst): InvoiceSnapshot["plant"] {
  const { tallyLedgers: _t, timezone: _z, einvoiceFrom: _e, ...rest } = p;
  return rest;
}

export function supplyFor(plant: PlantGst, party: PartyGst): SupplyType {
  return supplyTypeFor({ plantState: plant.stateCode, placeOfSupply: party.placeOfSupply, category: party.category });
}

export function composeSnapshot(input: {
  draftInput: InvoiceSnapshot["input"];
  plant: PlantGst;
  party: PartyGst;
  lines: Parameters<typeof computeInvoice>[0];
  refs: LineRef[];
  sources: DraftSource[];
  vehicleNo: string | null;
  against?: InvoiceSnapshot["against"];
  supplyType?: SupplyType;
  placeOfSupply?: string;
}): InvoiceSnapshot {
  const supplyType = input.supplyType ?? supplyFor(input.plant, input.party);
  const totals = computeInvoice(input.lines, supplyType);
  return {
    version: 1,
    input: input.draftInput,
    plant: plantForSnapshot(input.plant),
    party: input.party,
    supplyType,
    placeOfSupply: input.placeOfSupply ?? input.party.placeOfSupply,
    totals,
    refs: input.refs,
    sources: input.sources.map((s) => ({ plCode: s.plCode, plRevision: s.plRevision, dispatchCodes: s.dispatchCodes })),
    poNumbers: [...new Set(input.refs.map((r) => r.poNumber).filter((x): x is string => !!x))],
    vehicleNo: input.vehicleNo,
    amountInWords: amountInWords(totals.totalPaise),
    against: input.against ?? null,
  };
}

/** Does this document need an IRN: e-invoice on, on or after the plant's start date, to a registered, SEZ or export party. */
export function needsIrnFor(input: { einvoiceOn: boolean; einvoiceFrom: string | null; invoiceDate: string; party: PartyGst }): boolean {
  if (!input.einvoiceOn) return false;
  if (input.einvoiceFrom && input.einvoiceFrom > input.invoiceDate) return false;
  return input.party.category !== "unregistered";
}

export function sellerParty(s: InvoiceSnapshot): EinvoiceParty {
  return {
    gstin: s.plant.gstin,
    legalName: s.plant.legalName,
    tradeName: s.plant.tradeName,
    address1: s.plant.address,
    place: s.plant.place,
    pincode: s.plant.pincode,
    stateCode: s.plant.stateCode,
    phone: s.plant.phone,
  };
}

export function buyerParty(s: InvoiceSnapshot): EinvoiceParty {
  const p = s.party;
  return { gstin: p.gstin, legalName: p.name, address1: p.address, place: p.place, pincode: p.pincode, stateCode: p.stateCode, phone: p.phone, email: p.email };
}

export function einvoiceModel(s: InvoiceSnapshot, doc: { kind: "invoice" | "credit_note"; number: string; date: string }): EinvoiceModel {
  return {
    kind: doc.kind,
    number: doc.number,
    date: doc.date,
    supplyType: s.supplyType,
    placeOfSupply: s.placeOfSupply,
    seller: sellerParty(s),
    buyer: buyerParty(s),
    shipTo: s.party.shipTo,
    totals: s.totals,
    against: s.against ? { number: s.against.number, date: s.against.date } : null,
  };
}

export { taxHeadsFor };
