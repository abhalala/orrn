/**
 * URL search params of the quote, enquiry and works order routes. No imports on purpose: route files keep
 * `validateSearch` in the shared route tree (entry chunk), so anything they import lands in the JS every first
 * visit to `/` downloads (route budget). The pages import the same types from here.
 */

export const QUOTE_STATUS_FILTERS = ["draft", "sent", "converted", "cancelled", "expired"] as const;
export type QuoteStatusFilter = (typeof QUOTE_STATUS_FILTERS)[number];

export type QuotesSearch = { status?: QuoteStatusFilter; customer?: string; offset?: number };

/** `?status=draft|sent|converted|cancelled|expired&customer=<customer id>&offset=50`. */
export function parseQuotesSearch(search: Record<string, unknown>): QuotesSearch {
  const out: QuotesSearch = {};
  const status = typeof search.status === "string" ? (QUOTE_STATUS_FILTERS as readonly string[]).find((s) => s === search.status) : undefined;
  if (status) out.status = status as QuoteStatusFilter;
  if (typeof search.customer === "string" && search.customer.trim()) out.customer = search.customer.trim().slice(0, 64);
  const offset = Number(search.offset);
  if (Number.isInteger(offset) && offset > 0) out.offset = offset;
  return out;
}

/** `?enquiryId=<id>`: the enquiry a new quote answers. */
export function parseNewQuoteSearch(search: Record<string, unknown>): { enquiryId?: string } {
  return typeof search.enquiryId === "string" && search.enquiryId.trim() ? { enquiryId: search.enquiryId.trim().slice(0, 64) } : {};
}

export const ENQUIRY_VIEWS = ["open", "overdue", "all"] as const;
export type EnquiryView = (typeof ENQUIRY_VIEWS)[number];

/** `?overdue=1` shows the overdue ones, `?view=all` every enquiry (open when missing, so it keeps a clean URL). */
export function parseEnquiriesSearch(search: Record<string, unknown>): { view?: Exclude<EnquiryView, "open"> } {
  if (search.overdue === 1 || search.overdue === "1" || search.overdue === true || search.overdue === "true") return { view: "overdue" };
  if (search.view === "overdue") return { view: "overdue" };
  if (search.view === "all") return { view: "all" };
  return {};
}
