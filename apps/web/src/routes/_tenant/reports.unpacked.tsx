import { createFileRoute } from "@tanstack/react-router";

import { UnpackedReport } from "@/features/reports/reg-unpacked";

export const Route = createFileRoute("/_tenant/reports/unpacked")({
  component: UnpackedReport,
});
