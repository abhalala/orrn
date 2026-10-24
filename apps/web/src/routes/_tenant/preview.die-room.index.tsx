import { createFileRoute } from "@tanstack/react-router";

import { DieRoomBoard } from "@/features/preview/die-room/board";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("die-room")!;

export const Route = createFileRoute("/_tenant/preview/die-room/")({
  component: DieRoomPreview,
});

function DieRoomPreview() {
  return (
    <PreviewFrame
      title="Dies"
      summary="Sections, copies, and which copy to run first."
      featureIds={["FP-DR-01", "FP-DR-02", "FP-DR-03", "FP-DR-04", "FP-DR-06", "FP-DR-12", "FP-DR-14", "FP-DR-15"]}
      specPath={mod.specPath}
    >
      <DieRoomBoard />
    </PreviewFrame>
  );
}
