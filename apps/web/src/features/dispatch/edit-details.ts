import type { PickedCustomer } from "./customer-picker";
import { parseDayInput } from "./format";

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
