/**
 * What a scrap lot screen shows and offers, from the lot's status, its D/C
 * notes and the person's permissions. Pure, so the rules are unit-tested and
 * the detail page and list agree.
 */
import type { StatusTone } from "@orrn/domain";

export type LotStatus = "booking" | "unload" | "ok" | "cancelled";

/** Booked = truck expected (quiet), Unloading = at the kanta (attention), OK = in scrap stock, Cancelled. */
export const LOT_TONE: Record<LotStatus, StatusTone> = {
  booking: "neutral",
  unload: "amber",
  ok: "green",
  cancelled: "red",
};

export type NoteForSteps = {
  status: "pending" | "approved" | "rejected";
  type: "debit" | "credit";
  reason: "weight" | "grade";
  boriDeductionG: number;
};

export type LotForSteps = {
  status: LotStatus;
  fcKgG: number | null;
  shortBeyondTolerance: boolean;
  noteCoversShort: boolean;
  notes: NoteForSteps[];
};

/** purchase.receipt (yard, office), purchase.dcnote (office), masters.publish (manager, admin). */
export type LotPerms = { receipt: boolean; dcnote: boolean; publish: boolean };

export type LotNextStep = {
  /** The one big action: weigh on our kanta, raise the debit note, or mark OK. */
  primary: "weigh" | "note" | "ok" | null;
  /** Why OK can't happen yet, to say so on screen. */
  blocked: "weigh" | "short" | null;
  canUnload: boolean;
  canCancel: boolean;
  canEditWeights: boolean;
  canRaiseNote: boolean;
};

const FROZEN: LotNextStep = {
  primary: null,
  blocked: null,
  canUnload: false,
  canCancel: false,
  canEditWeights: false,
  canRaiseNote: false,
};

/** A live note raised on the weights (the server locks party and FC kg while one exists). */
function locksWeights(notes: NoteForSteps[]): boolean {
  return notes.some(
    (n) =>
      (n.status === "pending" || n.status === "approved") &&
      ((n.type === "debit" && n.reason === "weight") || n.boriDeductionG > 0),
  );
}

export function lotNextStep(lot: LotForSteps, perms: LotPerms): LotNextStep {
  if (lot.status === "cancelled") return FROZEN;
  const pendingNote = lot.notes.some((n) => n.status === "pending");
  const canRaiseNote = perms.dcnote && !pendingNote;

  if (lot.status === "ok") {
    // Stock fields are locked once OK; a manager may still cancel (reverses the stock).
    return { ...FROZEN, canCancel: perms.publish, canRaiseNote };
  }

  const blocked: LotNextStep["blocked"] =
    lot.fcKgG === null ? "weigh" : lot.shortBeyondTolerance && !lot.noteCoversShort ? "short" : null;
  let primary: LotNextStep["primary"] = null;
  if (blocked === "weigh") primary = perms.receipt ? "weigh" : null;
  else if (blocked === "short") primary = canRaiseNote ? "note" : null;
  else primary = perms.receipt ? "ok" : null;

  return {
    primary,
    blocked,
    canUnload: perms.receipt && lot.status === "booking",
    canCancel: perms.receipt || perms.publish,
    canEditWeights: perms.receipt && !locksWeights(lot.notes),
    canRaiseNote,
  };
}

const RUPEES = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Paise (per kg, or an amount) as "₹198.50". */
export function formatRate(paise: number): string {
  return `₹${RUPEES.format(paise / 100)}`;
}
