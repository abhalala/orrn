/**
 * The new-lot stepper's draft: raw text exactly as typed (numbers are parsed
 * only here), per-step checks that name the field and the fix, and the
 * conversion to `purchase.lots.create` / `purchase.dcNotes.create` input
 * (kg to grams, rupees to paise, % to basis points).
 */
import { parseDecimal } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { MAX_LOT_KG, kgTextToG, readKanta } from "./kanta";

export type BillBook = "main" | "wb" | "ub";
export const BILL_BOOKS: readonly BillBook[] = ["main", "wb", "ub"];

export const LOT_STEPS = ["vendor", "material", "weights", "book"] as const;
export type LotStep = (typeof LOT_STEPS)[number];

/** The server caps a rate at ₹10,000 per kg. */
const MAX_RATE_RUPEES = 10_000;

export type LotDraft = {
  vendorId: string | null;
  vendorLabel: string;
  itemId: string | null;
  /** Grade code, "A+", "A", "B", "C". */
  grade: string | null;
  rateText: string;
  origin: string;
  drossText: string;
  partyText: string;
  fcText: string;
  /** Raise the debit note in the same save when the lot is short beyond tolerance. */
  raiseNote: boolean;
  noteKgText: string;
  boriText: string;
  noteText: string;
  billBook: BillBook;
  partyBillNo: string;
  vehicleNo: string;
  /** Book date YYYY-MM-DD. */
  date: string;
  notes: string;
};

export const EMPTY_DRAFT: LotDraft = {
  vendorId: null,
  vendorLabel: "",
  itemId: null,
  grade: null,
  rateText: "",
  origin: "",
  drossText: "",
  partyText: "",
  fcText: "",
  raiseNote: true,
  noteKgText: "",
  boriText: "",
  noteText: "",
  billBook: "main",
  partyBillNo: "",
  vehicleNo: "",
  date: "",
  notes: "",
};

export type DraftField =
  | "vendor"
  | "item"
  | "grade"
  | "rate"
  | "origin"
  | "dross"
  | "party"
  | "fc"
  | "noteKg"
  | "bori"
  | "date"
  | "vehicle"
  | "billNo"
  | "notes";

export type DraftErrors = Partial<Record<DraftField, MessageKey>>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function weightError(text: string, required: boolean, missing: MessageKey): MessageKey | undefined {
  if (text.trim() === "") return required ? missing : undefined;
  const g = kgTextToG(text);
  if (g === null) return missing;
  if (g > MAX_LOT_KG * 1000) return "purchase.errors.tooHeavy";
  return undefined;
}

export function stepErrors(draft: LotDraft, step: LotStep, opts: { toleranceBp?: number } = {}): DraftErrors {
  const errors: DraftErrors = {};
  if (step === "vendor") {
    if (!draft.vendorId) errors.vendor = "purchase.errors.vendor";
  } else if (step === "material") {
    if (!draft.itemId) errors.item = "purchase.errors.item";
    if (!draft.grade) errors.grade = "purchase.errors.grade";
    const rate = parseDecimal(draft.rateText);
    if (rate === null || rate <= 0) errors.rate = "purchase.errors.rate";
    else if (rate > MAX_RATE_RUPEES) errors.rate = "purchase.errors.rateHigh";
    if (draft.drossText.trim() !== "") {
      const dross = parseDecimal(draft.drossText);
      if (dross === null || dross > 100) errors.dross = "purchase.errors.dross";
    }
    if (draft.origin.trim().length > 80) errors.origin = "purchase.errors.origin";
  } else if (step === "weights") {
    const party = weightError(draft.partyText, true, "purchase.errors.party");
    const fc = weightError(draft.fcText, false, "purchase.errors.fc");
    if (party) errors.party = party;
    if (fc) errors.fc = fc;
    if (!party && !fc && draft.raiseNote) {
      const reading = readKanta(draft.partyText, draft.fcText, opts.toleranceBp ?? 50);
      if (reading.needsNote) {
        const noteG = kgTextToG(draft.noteKgText);
        if (noteG === null || noteG < reading.minNoteG) errors.noteKg = "purchase.errors.noteTooSmall";
        else if (noteG > reading.partyG!) errors.noteKg = "purchase.errors.noteTooBig";
        if (draft.boriText.trim() !== "") {
          const boriG = kgTextToG(draft.boriText);
          if (boriG === null || boriG >= reading.fcG!) errors.bori = "purchase.errors.bori";
        }
      }
    }
  } else {
    if (!ISO_DATE.test(draft.date)) errors.date = "purchase.errors.date";
    if (draft.vehicleNo.trim().length > 20) errors.vehicle = "purchase.errors.vehicle";
    if (draft.partyBillNo.trim().length > 60) errors.billNo = "purchase.errors.billNo";
    if (draft.notes.trim().length > 500) errors.notes = "purchase.errors.notes";
  }
  return errors;
}

/** Steps with nothing wrong, for "Save" and for jumping back to the first bad step. */
export function firstStepWithErrors(draft: LotDraft, opts: { toleranceBp?: number } = {}): LotStep | null {
  return LOT_STEPS.find((s) => Object.keys(stepErrors(draft, s, opts)).length > 0) ?? null;
}

export type LotCreateInput = {
  vendorId: string;
  itemId: string;
  grade: string;
  ratePaise: number;
  partyKgG: number;
  fcKgG?: number;
  billBook: BillBook;
  date: string;
  drossBp?: number;
  origin?: string;
  partyBillNo?: string;
  vehicleNo?: string;
  notes?: string;
};

/** Call only after every step passes `stepErrors`. */
export function draftToCreateInput(draft: LotDraft): LotCreateInput {
  const input: LotCreateInput = {
    vendorId: draft.vendorId!,
    itemId: draft.itemId!,
    grade: draft.grade!,
    ratePaise: Math.round(parseDecimal(draft.rateText)! * 100),
    partyKgG: kgTextToG(draft.partyText)!,
    billBook: draft.billBook,
    date: draft.date,
  };
  const fc = kgTextToG(draft.fcText);
  if (fc !== null) input.fcKgG = fc;
  const dross = draft.drossText.trim() === "" ? null : parseDecimal(draft.drossText);
  if (dross !== null) input.drossBp = Math.round(dross * 100);
  const origin = draft.origin.trim();
  if (origin) input.origin = origin;
  const bill = draft.partyBillNo.trim();
  if (bill) input.partyBillNo = bill;
  // Plates are written with and without spaces; keep one form so they can be found again.
  const vehicle = draft.vehicleNo.replace(/\s+/g, "").toUpperCase();
  if (vehicle) input.vehicleNo = vehicle;
  const notes = draft.notes.trim();
  if (notes) input.notes = notes;
  return input;
}

export type NoteCreateInput = {
  lotId: string;
  type: "debit";
  reason: "weight";
  kgDiffG: number;
  boriDeductionG: number;
  note?: string;
};

/** The inline weight debit note, or null when not asked for or not needed. */
export function draftToNoteInput(draft: LotDraft, lotId: string, toleranceBp: number): NoteCreateInput | null {
  if (!draft.raiseNote) return null;
  const reading = readKanta(draft.partyText, draft.fcText, toleranceBp);
  if (!reading.needsNote) return null;
  const kgDiffG = kgTextToG(draft.noteKgText);
  if (kgDiffG === null) return null;
  const input: NoteCreateInput = {
    lotId,
    type: "debit",
    reason: "weight",
    kgDiffG,
    boriDeductionG: kgTextToG(draft.boriText) ?? 0,
  };
  const note = draft.noteText.trim();
  if (note) input.note = note;
  return input;
}
