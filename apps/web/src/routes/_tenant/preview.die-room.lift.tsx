import { createFileRoute } from "@tanstack/react-router";

import { LiftScreen } from "@/features/preview/die-room/lift-panel";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("die-room")!;

export const Route = createFileRoute("/_tenant/preview/die-room/lift")({
  component: LiftPreview,
});

function LiftPreview() {
  return (
    <PreviewFrame
      title="Lift"
      summary="12170-2 stays 12170-2. A person moves the band."
      featureIds={["FP-DR-06", "FP-DR-10"]}
      specPath={mod.specPath}
    >
      <LiftScreen />
    </PreviewFrame>
  );
}
