/** Pure helpers for the master pickers (XE ADM): which entries a picker offers, and money typed as rupees. */

export type MasterItem = { id: string; name: string; active: boolean; expectedLifeG?: number | null };

/**
 * The entries a picker offers: the active ones in the server's list order, plus the one already chosen
 * even when it has been retired since (so the current value is never shown as blank).
 */
export function pickerItems(items: readonly MasterItem[] | undefined, current: string | null | undefined): MasterItem[] {
  return (items ?? []).filter((m) => m.active || m.id === current);
}

/** The select's value for a stored id: "" is the empty choice. */
export const pickerValue = (current: string | null | undefined): string => current ?? "";

/** The id a select value stands for: "" clears. */
export const pickerId = (value: string): string | null => (value === "" ? null : value);
