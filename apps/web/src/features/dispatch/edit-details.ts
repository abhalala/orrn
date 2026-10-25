import type { PickedCustomer } from "./customer-picker";
import { isoDayInput, parseDayInput } from "./format";

/** What the Edit details sheet holds: the customer, the ship date as typed (yyyy-mm-dd), the notes. */
export type DetailsFields = { customer: PickedCustomer; shipDate: string; notes: string };

export type DetailsChanges = { customerId?: string; shipDate?: number | null; notes?: string | null };

/**
 * Only the details the person changed since the sheet opened. `dispatch.update`
 * leaves a field it is not sent as it is, so Save never puts back a value
 * someone else changed meanwhile.
 */
export function changedDetails(before: DetailsFields, after: DetailsFields): DetailsChanges {
  const out: DetailsChanges = {};
  if (after.customer.id !== before.customer.id) out.customerId = after.customer.id;
  if (after.shipDate !== before.shipDate) out.shipDate = parseDayInput(after.shipDate);
  if (after.notes.trim() !== before.notes.trim()) out.notes = after.notes.trim() || null;
  return out;
}

/**
 * The ship date the Edit details form opens with: the server's ship day when it is an entered ship date (the very day
 * the page shows), else the stored date's UTC day. Never a completion day: that is not a ship date.
 */
export function shipDatePrefill(d: { shipDate: string | Date | null; shipDay?: { ymd: string; kind: "dispatched" | "ship" } | null }): string {
  if (!d.shipDate) return "";
  return d.shipDay?.kind === "ship" ? d.shipDay.ymd : isoDayInput(d.shipDate);
}
