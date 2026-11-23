/**
 * The enquiry sheet's draft and what is sent for it (`pricing.enquiries.create` / `update`). Pure, so it is
 * unit-tested. In an update `undefined` means "unchanged" on the server and `null` clears a field, so an edit sends
 * every field spelled out.
 */
import type { MessageKey } from "@orrn/i18n";

import { kgFieldText } from "@/features/orders/format";
import { parseKgG } from "@/features/orders/line-model";

import type { Picked } from "./quote-model";

export const ENQUIRY_STATUS_LIST = ["open", "quoted", "won", "lost", "dropped"] as const;
export type EnquiryStatusValue = (typeof ENQUIRY_STATUS_LIST)[number];

export type EnquiryDraft = {
  customer: Picked | null;
  prospectName: string;
  contact: string;
  /** A section from the catalogue; when set it wins over the typed text. */
  section: Picked | null;
  sectionText: string;
  kgText: string;
  followUpDate: string;
  note: string;
  status: EnquiryStatusValue;
};

export function blankEnquiry(): EnquiryDraft {
  return { customer: null, prospectName: "", contact: "", section: null, sectionText: "", kgText: "", followUpDate: "", note: "", status: "open" };
}

export type EnquiryRow = {
  id: string;
  serverSeq: number;
  customerId: string | null;
  customerName: string | null;
  prospectName: string | null;
  contact: string | null;
  sectionId: string | null;
  sectionCode: string | null;
  sectionText: string | null;
  kgG: number | null;
  followUpDate: string | null;
  note: string | null;
  status: string;
};

export function draftFromEnquiry(r: EnquiryRow): EnquiryDraft {
  const status = (ENQUIRY_STATUS_LIST as readonly string[]).includes(r.status) ? (r.status as EnquiryStatusValue) : "open";
  return {
    customer: r.customerId ? { id: r.customerId, label: r.customerName ?? "" } : null,
    prospectName: r.prospectName ?? "",
    contact: r.contact ?? "",
    section: r.sectionId ? { id: r.sectionId, label: r.sectionCode ?? "" } : null,
    sectionText: r.sectionText ?? "",
    kgText: r.kgG != null ? kgFieldText(r.kgG) : "",
    followUpDate: r.followUpDate ?? "",
    note: r.note ?? "",
    status,
  };
}

export type EnquiryProblems = { party?: MessageKey; kg?: MessageKey };

export function enquiryProblems(d: EnquiryDraft): EnquiryProblems {
  const out: EnquiryProblems = {};
  if (!d.customer && d.prospectName.trim() === "") out.party = "price.enquiries.form.errors.party";
  if (d.kgText.trim() !== "" && parseKgG(d.kgText) == null) out.kg = "price.quotes.form.errors.kg";
  return out;
}

const blank = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** The `enquiries.create` input: only what was filled in. */
export function toEnquiryCreate(d: EnquiryDraft) {
  const kgG = parseKgG(d.kgText);
  return {
    ...(d.customer ? { customerId: d.customer.id } : {}),
    ...(blank(d.prospectName) ? { prospectName: blank(d.prospectName)! } : {}),
    ...(blank(d.contact) ? { contact: blank(d.contact)! } : {}),
    ...(d.section ? { sectionId: d.section.id } : {}),
    ...(blank(d.sectionText) ? { sectionText: blank(d.sectionText)! } : {}),
    ...(kgG != null ? { kgG } : {}),
    ...(d.followUpDate ? { followUpDate: d.followUpDate } : {}),
    ...(blank(d.note) ? { note: blank(d.note)! } : {}),
  };
}

/** The `enquiries.update` input: every field spelled out, null where it is empty (null clears, undefined keeps). */
export function toEnquiryUpdate(d: EnquiryDraft, id: string, serverSeq: number) {
  return {
    id,
    serverSeq,
    customerId: d.customer?.id ?? null,
    prospectName: blank(d.prospectName),
    contact: blank(d.contact),
    sectionId: d.section?.id ?? null,
    sectionText: blank(d.sectionText),
    kgG: parseKgG(d.kgText),
    followUpDate: d.followUpDate || null,
    note: blank(d.note),
    status: d.status,
  };
}

/** Who the enquiry is from: the customer, else the prospect's name. */
export function enquiryParty(r: Pick<EnquiryRow, "customerName" | "prospectName">): string {
  return (r.customerName ?? "").trim() || (r.prospectName ?? "").trim();
}

/** What was asked for: the section's code, else the typed words. */
export function enquirySection(r: Pick<EnquiryRow, "sectionCode" | "sectionText">): string {
  return (r.sectionCode ?? "").trim() || (r.sectionText ?? "").trim();
}

/** Whether a quote can still be made from this enquiry (it is open or already quoted). */
export function canMakeQuote(status: string): boolean {
  return status === "open" || status === "quoted";
}
