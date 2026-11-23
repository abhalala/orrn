import { createFileRoute } from "@tanstack/react-router";

import { OutstandingPage } from "@/features/billing/outstanding-page";

export const Route = createFileRoute("/_tenant/billing/outstanding")({
  component: OutstandingPage,
});
