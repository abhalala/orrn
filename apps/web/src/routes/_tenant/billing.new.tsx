import { createFileRoute } from "@tanstack/react-router";

import { NewInvoicePage } from "@/features/billing/new-invoice-page";

export const Route = createFileRoute("/_tenant/billing/new")({
  component: NewInvoicePage,
});
