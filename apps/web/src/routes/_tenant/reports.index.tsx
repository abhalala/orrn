import { createFileRoute } from "@tanstack/react-router";

import { ReportsIndex } from "@/features/reports/reports-index";

export const Route = createFileRoute("/_tenant/reports/")({
  component: ReportsIndex,
});
