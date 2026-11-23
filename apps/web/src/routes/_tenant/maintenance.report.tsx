import { createFileRoute } from "@tanstack/react-router";

import { MaintReportPage } from "@/features/maintenance/report-page";

export const Route = createFileRoute("/_tenant/maintenance/report")({
  component: MaintReportPage,
});
