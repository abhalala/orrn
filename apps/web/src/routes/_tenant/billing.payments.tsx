import { createFileRoute } from "@tanstack/react-router";

import { PaymentsPage } from "@/features/billing/payments-page";
import { paymentsSearch } from "@/features/billing/search";

export const Route = createFileRoute("/_tenant/billing/payments")({
  // An invoice page links here with its customer and invoice, to open the payment form already filled.
  validateSearch: paymentsSearch,
  component: PaymentsRoute,
});

function PaymentsRoute() {
  const { customerId, invoiceId } = Route.useSearch();
  return <PaymentsPage customerId={customerId} invoiceId={invoiceId} />;
}
