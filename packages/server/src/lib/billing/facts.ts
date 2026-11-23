/**
 * XE-BILL: reading the GST facts an invoice needs, from their single sources:
 * - the plant: `company.settings.letterhead` (legal name, GSTIN, address, phone) + `billing_settings`;
 * - the customer: `customer` (name, tax_id = GSTIN, billing address) + `customer_gst` (state, pincode,
 *   category, ship-to, place of supply).
 * Each loader returns the facts and the list of what is missing, in plant words, so a draft can say what to fix.
 */
import { and, eq, isNull } from "drizzle-orm";

import { billingSettings, customerGst, gstHsn } from "@orrn/db/schema/billing";
import { customer } from "@orrn/db/schema/customers";
import { company } from "@orrn/db/schema/tenant";
import {
  GST_STATE_CODES,
  gstinProblem,
  gstinState,
  isPincode,
  isStateCode,
  normaliseGstin,
  pincodeFitsState,
  placeOfSupplyFor,
  readTallyLedgers,
  type EinvoiceParty,
  type TallyLedgers,
  type TaxCategory,
} from "@orrn/domain";

import type { OrrnDb } from "../atomic";
import { companyTimezone } from "../dayWindow";

export type PlantGst = {
  name: string;
  legalName: string;
  tradeName: string | null;
  gstin: string;
  stateCode: string;
  address: string;
  place: string;
  pincode: string;
  phone: string | null;
  signatory: string | null;
  terms: string | null;
  einvoiceFrom: string | null;
  timezone: string;
  tallyLedgers: TallyLedgers;
};

/** One address line from the stored JSON shapes (`{ line1, city, state, pincode }` or `{ name, lines: [] }`). */
export function addressText(raw: Record<string, unknown> | null | undefined): string {
  if (!raw || typeof raw !== "object") return "";
  const lines = Array.isArray(raw.lines) ? raw.lines.filter((x): x is string => typeof x === "string") : [];
  const parts = lines.length > 0 ? lines : ["line1", "line2", "city", "state"].map((k) => raw[k]).filter((x): x is string => typeof x === "string");
  return parts.map((p) => p.trim()).filter(Boolean).join(", ");
}

export async function loadPlantGst(db: OrrnDb, companyId: string): Promise<{ plant: PlantGst | null; missing: string[]; settings: Record<string, unknown> }> {
  const [co] = await db.select({ name: company.name, settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  const settings = (co?.settings ?? {}) as Record<string, unknown>;
  const lh = (settings.letterhead ?? {}) as Record<string, unknown>;
  const [bs] = await db.select().from(billingSettings).where(eq(billingSettings.companyId, companyId)).limit(1);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const gstin = normaliseGstin(str(lh.gstin));
  const missing: string[] = [];
  if (gstinProblem(gstin)) missing.push("plant_gstin");
  if (!str(lh.legalName)) missing.push("plant_legal_name");
  if (!str(lh.address)) missing.push("plant_address");
  if (!bs?.stateCode || !isStateCode(bs.stateCode) || gstinState(gstin) !== bs.stateCode) missing.push("plant_state");
  if (!bs?.pincode || !isPincode(bs.pincode) || (bs.stateCode && !pincodeFitsState(bs.pincode, bs.stateCode))) missing.push("plant_pincode");
  if (!bs?.place) missing.push("plant_place");
  if (missing.length > 0) return { plant: null, missing, settings };
  return {
    plant: {
      name: co!.name,
      legalName: str(lh.legalName)!,
      tradeName: bs!.tradeName ?? null,
      gstin,
      stateCode: bs!.stateCode!,
      address: str(lh.address)!,
      place: bs!.place!,
      pincode: bs!.pincode!,
      phone: str(lh.phone),
      signatory: bs!.signatory ?? null,
      terms: bs!.terms ?? null,
      einvoiceFrom: bs!.einvoiceFrom ?? null,
      timezone: companyTimezone(settings),
      tallyLedgers: readTallyLedgers(bs?.tallyLedgers ?? null),
    },
    missing,
    settings,
  };
}

export type PartyGst = {
  customerId: string;
  name: string;
  category: TaxCategory;
  gstin: string | null;
  stateCode: string;
  stateName: string;
  address: string;
  place: string;
  pincode: string;
  phone: string | null;
  email: string | null;
  placeOfSupply: string;
  shipTo: (EinvoiceParty & { kind: "party" | "address" }) | null;
  distanceKm: number | null;
};

const REGISTERED: readonly TaxCategory[] = ["regular", "sez_with_payment", "sez_without_payment"];

export function partyIsRegistered(category: TaxCategory): boolean {
  return REGISTERED.includes(category);
}

export async function loadPartyGst(db: OrrnDb, companyId: string, customerId: string): Promise<{ party: PartyGst | null; missing: string[] }> {
  const [c] = await db
    .select()
    .from(customer)
    .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId), isNull(customer.deletedAt)))
    .limit(1);
  if (!c) return { party: null, missing: ["customer"] };
  const [g] = await db.select().from(customerGst).where(and(eq(customerGst.companyId, companyId), eq(customerGst.customerId, customerId))).limit(1);
  const category: TaxCategory = (g?.taxCategory as TaxCategory | undefined) ?? "regular";
  const gstin = c.taxId ? normaliseGstin(c.taxId) : null;
  const billing = (c.billingAddress ?? null) as Record<string, unknown> | null;
  const pinFromAddress = typeof billing?.pincode === "string" ? billing.pincode.trim() : null;
  const pincode = g?.pincode ?? pinFromAddress ?? "";
  const placeFromAddress = typeof billing?.city === "string" ? billing.city.trim() : null;
  const place = g?.place ?? placeFromAddress ?? "";
  const exportParty = category === "export_with_payment" || category === "export_without_payment";
  const stateCode = exportParty ? "96" : (gstin && partyIsRegistered(category) ? gstinState(gstin) : null) ?? g?.stateCode ?? "";
  const missing: string[] = [];
  if (partyIsRegistered(category)) {
    if (gstinProblem(gstin)) missing.push("party_gstin");
    else if (g?.stateCode && g.stateCode !== gstinState(gstin)) missing.push("party_state");
  }
  if (!isStateCode(stateCode)) missing.push("party_state");
  if (!exportParty && (!isPincode(pincode) || !pincodeFitsState(pincode, stateCode))) missing.push("party_pincode");
  if (!place) missing.push("party_place");
  const address = addressText(billing);
  if (!address) missing.push("party_address");

  let shipTo: PartyGst["shipTo"] = null;
  if (g?.shipToKind === "party" && g.shipToCustomerId) {
    const [s] = await db
      .select()
      .from(customer)
      .where(and(eq(customer.id, g.shipToCustomerId), eq(customer.companyId, companyId), isNull(customer.deletedAt)))
      .limit(1);
    const [sg] = s ? await db.select().from(customerGst).where(and(eq(customerGst.companyId, companyId), eq(customerGst.customerId, s.id))).limit(1) : [];
    if (!s) missing.push("ship_to");
    else {
      const sAddr = (s.shippingAddress ?? s.billingAddress ?? null) as Record<string, unknown> | null;
      const sGstin = s.taxId ? normaliseGstin(s.taxId) : null;
      const sState = (sGstin ? gstinState(sGstin) : null) ?? sg?.stateCode ?? "";
      shipTo = {
        kind: "party",
        gstin: sGstin && !gstinProblem(sGstin) ? sGstin : null,
        legalName: s.name,
        address1: addressText(sAddr) || s.name,
        place: sg?.place ?? (typeof sAddr?.city === "string" ? sAddr.city : "") ?? "",
        pincode: sg?.pincode ?? (typeof sAddr?.pincode === "string" ? sAddr.pincode : "") ?? "",
        stateCode: sState,
      };
    }
  } else if (g?.shipToKind === "address") {
    shipTo = {
      kind: "address",
      gstin: g.shipToGstin && !gstinProblem(g.shipToGstin) ? normaliseGstin(g.shipToGstin) : null,
      legalName: g.shipToName ?? c.name,
      address1: g.shipToAddress ?? "",
      place: g.shipToPlace ?? "",
      pincode: g.shipToPincode ?? "",
      stateCode: g.shipToStateCode ?? "",
    };
  }
  if (shipTo && (!isStateCode(shipTo.stateCode) || !isPincode(shipTo.pincode) || !shipTo.address1 || !shipTo.place)) missing.push("ship_to");

  return {
    party: missing.length
      ? null
      : {
          customerId: c.id,
          name: c.name,
          category,
          gstin: partyIsRegistered(category) ? gstin : null,
          stateCode,
          stateName: GST_STATE_CODES[stateCode] ?? stateCode,
          address,
          place,
          pincode: exportParty ? "999999" : pincode,
          phone: c.phone ?? null,
          email: c.email ?? null,
          placeOfSupply: placeOfSupplyFor({ category, billToState: stateCode, explicit: g?.placeOfSupply ?? null }),
          shipTo,
          distanceKm: g?.distanceKm ?? null,
        },
    missing,
  };
}

export async function defaultHsn(db: OrrnDb, companyId: string) {
  const [row] = await db
    .select()
    .from(gstHsn)
    .where(and(eq(gstHsn.companyId, companyId), eq(gstHsn.isDefault, true), eq(gstHsn.active, true)))
    .limit(1);
  return row ?? null;
}
