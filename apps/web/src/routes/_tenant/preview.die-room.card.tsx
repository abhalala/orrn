import { createFileRoute } from "@tanstack/react-router";

import { DieCardScreen } from "@/features/preview/die-room/die-card";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("die-room")!;

export const Route = createFileRoute("/_tenant/preview/die-room/card")({
  component: DieCardPreview,
});

function DieCardPreview() {
  return (
    <PreviewFrame
      title="Die card"
      summary="12170-1 · Domal · tier 1"
      featureIds={["FP-DR-01", "FP-DR-04", "FP-DR-05", "FP-DR-06", "FP-DR-07", "FP-DR-08", "FP-DR-09", "FP-DR-13", "FP-DR-14"]}
      specPath={mod.specPath}
    >
      <DieCardScreen />
    </PreviewFrame>
  );
}
