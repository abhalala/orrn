/** Reference copy of the die room date helpers before the plant formatter (units layer, slice b part 3). No screen imports it. */

/** "24 Oct 2026" from an ISO string, epoch ms or Date (the API sends ISO strings). Empty when unknown. */
export function shortDate(value: string | number | Date | null | undefined): string {
  if (value == null) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** "24 Oct, 09:12" for a reading or an issue. */
export function shortDateTime(value: string | number | Date | null | undefined): string {
  if (value == null) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

