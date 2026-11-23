import { createFileRoute } from "@tanstack/react-router";

import { IncentivePage } from "@/features/hr/incentive-page";

export const Route = createFileRoute("/_tenant/hr/incentive")({
  component: IncentivePage,
});
