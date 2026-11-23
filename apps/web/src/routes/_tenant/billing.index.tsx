import { createFileRoute } from "@tanstack/react-router";

import { InvoicesPage } from "@/features/billing/invoices-page";

export const Route = createFileRoute("/_tenant/billing/")({
  component: InvoicesPage,
});
