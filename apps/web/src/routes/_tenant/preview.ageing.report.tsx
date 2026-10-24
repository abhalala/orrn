import { createFileRoute } from "@tanstack/react-router";

import { AgeingReport } from "@/features/preview/ageing/report";

export const Route = createFileRoute("/_tenant/preview/ageing/report")({
  component: AgeingReport,
});
