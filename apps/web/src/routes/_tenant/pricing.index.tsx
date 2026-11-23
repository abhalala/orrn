import { createFileRoute } from "@tanstack/react-router";

import { PricingMasterPage } from "@/features/pricing/master/master-page";

/** The price master: rates, customer terms and pricing settings. Quotes and enquiries have their own pages. */
export const Route = createFileRoute("/_tenant/pricing/")({
  component: PricingMasterPage,
});
