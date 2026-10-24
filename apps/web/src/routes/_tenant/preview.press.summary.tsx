import { createFileRoute } from "@tanstack/react-router";

import { PressScreen } from "@/features/preview/press/components/chrome";
import { SummaryView } from "@/features/preview/press/components/summary-view";

export const Route = createFileRoute("/_tenant/preview/press/summary")({
  component: PressSummaryPage,
});

function PressSummaryPage() {
  return (
    <PressScreen
      title="Press summary"
      summary="The Today tile, enlarged. The day opens at 08:00."
      featureIds={["FP-PR-11", "FP-PR-12", "FP-PR-18"]}
    >
      <SummaryView />
    </PressScreen>
  );
}
