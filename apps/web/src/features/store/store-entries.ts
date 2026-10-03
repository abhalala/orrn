import type { StatusTone } from "@orrn/domain";

/** The fields of a `store.txns` row these helpers read. */
export type EntryLike = {
  id: string;
  kind: "grn" | "mrs";
  number: string;
  itemId: string;
  qtyMilli: number;
  exchangeId: string | null;
  cancelledAt: Date | string | number | null;
  /**
   * Set when another record wrote this entry in its own batch (a melt's flux draw, PL-7 review):
   * that record's cancel reverses it, and `store.cancel` refuses it (`store.txns` returns it).
   */
  sourceType?: string | null;
};

export type EntryState = "received" | "issued" | "cancelled";

/** Received (GRN), issued (MRS) or cancelled (RP15: the entry keeps its number). */
export function entryState(entry: EntryLike): EntryState {
  if (entry.cancelledAt !== null && entry.cancelledAt !== undefined) return "cancelled";
  return entry.kind === "grn" ? "received" : "issued";
}

const TONES: Record<EntryState, StatusTone> = {
  received: "green",
  issued: "neutral",
  cancelled: "red",
};

/** Chip tone: green for stock in, quiet for stock out, red once cancelled. Always shown with its word. */
export function entryTone(entry: EntryLike): StatusTone {
  return TONES[entryState(entry)];
}

/** What the entry does to the store balance now: + for a GRN, - for an MRS, 0 once cancelled. */
export function signedQty(entry: EntryLike): number {
  const state = entryState(entry);
  if (state === "cancelled") return 0;
  return state === "received" ? entry.qtyMilli : -entry.qtyMilli;
}

/** The other leg of an old-for-new exchange, when it is among the loaded entries. */
export function exchangePartner<T extends EntryLike>(entry: T, all: readonly T[]): T | undefined {
  if (!entry.exchangeId) return undefined;
  return all.find((e) => e.exchangeId === entry.exchangeId && e.id !== entry.id);
}

/** Items from the newest entries first, each once: the item picker's "Recent" list. */
export function recentItemIds(entries: readonly Pick<EntryLike, "itemId">[], limit = 6): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (!out.includes(e.itemId)) out.push(e.itemId);
    if (out.length >= limit) break;
  }
  return out;
}

/** The kind of record that wrote this entry (a melt), or null for one the storekeeper typed. */
export function entrySource(entry: EntryLike): string | null {
  return entry.sourceType ?? null;
}

/**
 * Whether the storekeeper may cancel this entry here (RP15): not already cancelled, and not drawn
 * by another record (`sourceType`), which is undone by cancelling that record instead.
 */
export function canCancelEntry(entry: EntryLike): boolean {
  return entryState(entry) !== "cancelled" && !entry.sourceType;
}

/**
 * What a receive/issue/exchange answer means for the person (RP18). A replay of a saved entry is
 * still "saved" (one entry, one number); a replay of an entry cancelled meanwhile moved no stock.
 */
export function savedOutcome(result: { replayed: boolean; cancelled?: boolean }): "saved" | "cancelled" {
  return result.replayed && result.cancelled === true ? "cancelled" : "saved";
}
