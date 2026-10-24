import { createFileRoute } from "@tanstack/react-router";

import { PressScreen } from "@/features/preview/press/components/chrome";
import { ReportSheet } from "@/features/preview/press/components/report-sheet";

export const Route = createFileRoute("/_tenant/preview/press/report")({
  component: PressReportPage,
});

function PressReportPage() {
  return (
    <PressScreen
      title="Press report"
      summary="Logged runs for the production day. Recovery is calculated."
      featureIds={["FP-PR-11", "FP-PR-12", "FP-PR-17"]}
    >
      <ReportSheet />
    </PressScreen>
  );
}
