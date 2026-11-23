import { createFileRoute } from "@tanstack/react-router";

import { NewQuotePage } from "@/features/pricing/docs/quote-new-page";
import { parseNewQuoteSearch } from "@/features/pricing/docs/search";

/** A new quote; `?enquiryId=` starts it from an enquiry. */
export const Route = createFileRoute("/_tenant/pricing/quotes/new")({
  validateSearch: (search: Record<string, unknown>): { enquiryId?: string } => parseNewQuoteSearch(search),
  component: NewQuoteRoute,
});

function NewQuoteRoute() {
  const { enquiryId } = Route.useSearch();
  return <NewQuotePage key={enquiryId ?? "blank"} enquiryId={enquiryId} />;
}
