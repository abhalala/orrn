import { createFileRoute } from "@tanstack/react-router";

import { RunsPage } from "@/features/payroll/runs-page";

export const Route = createFileRoute("/_tenant/payroll/")({
  component: RunsPage,
});
