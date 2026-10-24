import { createFileRoute } from "@tanstack/react-router";

import { PressScreen } from "@/features/preview/press/components/chrome";
import { LineBoard } from "@/features/preview/press/components/line-board";

export const Route = createFileRoute("/_tenant/preview/press/")({
  component: PressLinesPage,
});

function PressLinesPage() {
  return (
    <PressScreen
      title="Press lines"
      summary="Today's line, and the jobs released to it."
      featureIds={["FP-PR-01", "FP-PR-02", "FP-PR-04", "FP-PR-05", "FP-PR-13", "FP-PR-18"]}
    >
      <LineBoard />
    </PressScreen>
  );
}
