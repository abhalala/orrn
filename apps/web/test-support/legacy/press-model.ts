/** Reference copy of the press clock helper before the plant formatter (units layer, slice b part 3). No screen imports it. */

/** `14:05` on the plant clock; empty for null. */
export function clockOf(at: Date | string | number | null | undefined, timeZone?: string): string {
  if (at === null || at === undefined) return "";
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  }
}

