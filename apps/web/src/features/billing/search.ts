/** The `/billing/payments` search parameters: plain checks, no view code, so the route's entry chunk stays small. */
export type PaymentsSearch = { customerId?: string; invoiceId?: string };

const clean = (v: unknown): string | undefined => (typeof v === "string" && v.trim() && v.length <= 64 ? v.trim() : undefined);

export function paymentsSearch(raw: Record<string, unknown>): PaymentsSearch {
  const customerId = clean(raw.customerId);
  // An invoice without its customer cannot open the form, so it is dropped.
  return customerId ? { customerId, invoiceId: clean(raw.invoiceId) } : {};
}
