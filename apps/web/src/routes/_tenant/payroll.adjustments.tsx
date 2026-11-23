import { createFileRoute } from "@tanstack/react-router";

import { AdjustmentsPage } from "@/features/payroll/adjustments-page";

export const Route = createFileRoute("/_tenant/payroll/adjustments")({
  component: AdjustmentsPage,
});
