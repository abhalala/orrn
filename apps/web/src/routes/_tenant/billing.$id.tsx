import { createFileRoute } from "@tanstack/react-router";

import { InvoiceDetailPage } from "@/features/billing/invoice-detail-page";

export const Route = createFileRoute("/_tenant/billing/$id")({
  component: InvoiceRoute,
});

function InvoiceRoute() {
  const { id } = Route.useParams();
  // Keyed by id: moving between an invoice and its credit note starts the page fresh (dialogs closed).
  return <InvoiceDetailPage key={id} id={id} />;
}
