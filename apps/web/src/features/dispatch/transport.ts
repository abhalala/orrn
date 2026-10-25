import { gToKg, kgToG, parseDecimal } from "@orrn/domain";

/**
 * Transport details of a dispatch (FP-PK-11/12): the truck's capacity and where it goes. The load
 * limit is typed in kg and kept in grams; blank means no warning. The server caps it at 100 t.
 */
export const MAX_CAPACITY_G = 100_000_000;

/** `undefined` = not a valid capacity; `null` = none; otherwise whole grams. */
export function parseCapacityKg(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const kg = parseDecimal(trimmed);
  if (kg === null || !(kg > 0)) return undefined;
  const g = kgToG(kg);
  return g > 0 && g <= MAX_CAPACITY_G ? g : undefined;
}

/** Grams back into the field: "9000" (kg, no grouping, no trailing zeros); "" for none. */
export function capacityKgText(g: number | null | undefined): string {
  return g == null ? "" : String(Number(gToKg(g).toFixed(3)));
}

export type TransportFields = {
  transporterId: string;
  vehicleNo: string;
  driverName: string;
  driverPhone: string;
  capacityKg: string;
  invoiceNumber: string;
  invoiceDate: string;
};

export const EMPTY_TRANSPORT: TransportFields = {
  transporterId: "",
  vehicleNo: "",
  driverName: "",
  driverPhone: "",
  capacityKg: "",
  invoiceNumber: "",
  invoiceDate: "",
};

export type TransportChanges = {
  transporterId?: string | null;
  vehicleNo?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  vehicleCapacityG?: number | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
};

/**
 * Only what changed since the sheet opened (the server leaves an unsent field as it is, so a save
 * never puts back a value someone else changed meanwhile). `invoice` fields go only to a person who
 * may link invoices. A capacity that is not a number is left out (the sheet shows the error).
 */
export function changedTransport(before: TransportFields, after: TransportFields, opts: { invoice: boolean }): TransportChanges {
  const out: TransportChanges = {};
  const text = (a: string, b: string) => a.trim() !== b.trim();
  if (after.transporterId !== before.transporterId) out.transporterId = after.transporterId || null;
  if (text(before.vehicleNo, after.vehicleNo)) out.vehicleNo = after.vehicleNo.trim() || null;
  if (text(before.driverName, after.driverName)) out.driverName = after.driverName.trim() || null;
  if (text(before.driverPhone, after.driverPhone)) out.driverPhone = after.driverPhone.trim() || null;
  if (text(before.capacityKg, after.capacityKg)) {
    const g = parseCapacityKg(after.capacityKg);
    if (g !== undefined) out.vehicleCapacityG = g;
  }
  if (opts.invoice) {
    if (text(before.invoiceNumber, after.invoiceNumber)) out.invoiceNumber = after.invoiceNumber.trim() || null;
    if (before.invoiceDate !== after.invoiceDate) out.invoiceDate = after.invoiceDate || null;
  }
  return out;
}
