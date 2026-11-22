import { createFileRoute } from "@tanstack/react-router";

import { QuoteDetailPage } from "@/features/pricing/docs/quote-detail-page";

export const Route = createFileRoute("/_tenant/pricing/quotes/$id")({
  component: QuoteRoute,
});

function QuoteRoute() {
  const { id } = Route.useParams();
  // Keyed by id: moving between quotes starts each page fresh (sheets closed, no stale errors).
  return <QuoteDetailPage key={id} id={id} />;
}
