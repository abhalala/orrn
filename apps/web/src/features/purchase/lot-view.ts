/**
 * What a scrap lot screen shows and offers, from the lot's status, its D/C
 * notes and the person's permissions. Pure, so the rules are unit-tested and
 * the detail page and list agree.
 */
import type { StatusTone } from "@orrn/domain";

export type LotStatus = "booking" | "unload" | "ok" | "cancelled";

/** Booked = entered at the kanta (quiet), Unloading = being unloaded (attention), OK = in scrap stock, Cancelled. */
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

/** The server's per-lot flag (`lots.get` / `register`): the owner's measure and a note waiting. */
export type LotFlag = "short_without_note" | "note_pending" | null;

export type LotForSteps = {
  status: LotStatus;
  fcKgG: number | null;
  shortBeyondTolerance: boolean;
  noteCoversShort: boolean;
  flag: LotFlag;
  notes: NoteForSteps[];
};

/** purchase.receipt (yard, office), purchase.dcnote (office), masters.publish (manager, admin). */
export type LotPerms = { receipt: boolean; dcnote: boolean; publish: boolean };

export type LotNextStep = {
  /** The one big action: weigh on our kanta, raise the debit note, or mark OK. */
  primary: "weigh" | "note" | "ok" | null;
  /** Why OK can't happen yet, to say so on screen. */
  blocked: "weigh" | "short" | null;
  /**
   * Short beyond tolerance with no live weight note covering it (the server's `short_without_note`),
   * at any status: an OK lot gets here when its covering note is rejected after OK. Always a red message.
   */
  shortWithoutNote: boolean;
  /** Edit weights is missing because a live weight note locks them (said on screen to those who could edit). */
  weightsLocked: boolean;
  canUnload: boolean;
  canCancel: boolean;
  canEditWeights: boolean;
  canRaiseNote: boolean;
};

const FROZEN: LotNextStep = {
  primary: null,
  blocked: null,
  shortWithoutNote: false,
  weightsLocked: false,
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

  const shortWithoutNote = lot.flag === "short_without_note" || (lot.shortBeyondTolerance && !lot.noteCoversShort);

  if (lot.status === "ok") {
    // Stock fields are locked once OK; a manager may still cancel (reverses the stock). A lot in
    // stock that is short without a live note needs one: that is the office's main step then.
    return {
      ...FROZEN,
      primary: shortWithoutNote && canRaiseNote ? "note" : null,
      shortWithoutNote,
      canCancel: perms.publish,
      canRaiseNote,
    };
  }

  const blocked: LotNextStep["blocked"] = lot.fcKgG === null ? "weigh" : shortWithoutNote ? "short" : null;
  let primary: LotNextStep["primary"] = null;
  if (blocked === "weigh") primary = perms.receipt ? "weigh" : null;
  else if (blocked === "short") primary = canRaiseNote ? "note" : null;
  else primary = perms.receipt ? "ok" : null;

  const locked = locksWeights(lot.notes);
  return {
    primary,
    blocked,
    shortWithoutNote: lot.fcKgG !== null && shortWithoutNote,
    weightsLocked: perms.receipt && locked,
    canUnload: perms.receipt && lot.status === "booking",
    canCancel: perms.receipt || perms.publish,
    canEditWeights: perms.receipt && !locked,
    canRaiseNote,
  };
}

/**
 * The list's attention chip, from the server's flag (ruling: short-without-note is a separate red
 * message, never a tone). No flag known (still loading, or past the register's cap): no chip.
 */
export function lotListChip(status: LotStatus, flag: LotFlag | undefined): "shortWithoutNote" | "notePending" | null {
  if (status === "cancelled" || flag == null) return null;
  return flag === "short_without_note" ? "shortWithoutNote" : "notePending";
}

/**
 * Kg the live weight debit notes come to beyond the whole short (party − ours), 0 when they don't.
 * A weight note bigger than the short is almost always a typo; the approver must be told.
 */
export function weightNotesOverShortG(shortG: number | null, weightNoteKgG: number): number {
  if (shortG === null) return 0;
  return Math.max(0, weightNoteKgG - Math.max(0, shortG));
}

/**
 * The most a new weight debit note may debit: what the live weight notes leave of the short.
 * Null when our kanta weight is not in yet (the server refuses a weight note then anyway).
 */
export function maxWeightDebitG(lot: { partyKgG: number; fcKgG: number | null }, liveWeightNoteKgG: number): number | null {
  if (lot.fcKgG === null) return null;
  return Math.max(0, lot.partyKgG - lot.fcKgG - liveWeightNoteKgG);
}

const RUPEES = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Paise (per kg, or an amount) as "₹198.50". */
export function formatRate(paise: number): string {
  return `₹${RUPEES.format(paise / 100)}`;
}
