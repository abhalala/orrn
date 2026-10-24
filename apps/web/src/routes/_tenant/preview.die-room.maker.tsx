import { createFileRoute } from "@tanstack/react-router";

import { MakerOwnerScreen } from "@/features/preview/die-room/maker-panel";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("die-room")!;

export const Route = createFileRoute("/_tenant/preview/die-room/maker")({
  component: MakerPreview,
});

function MakerPreview() {
  return (
    <PreviewFrame
      title="Maker and owner"
      summary="Send and receive a copy. Block a die that belongs to someone else."
      featureIds={["FP-DR-11", "FP-DR-12", "FP-DR-16"]}
      specPath={mod.specPath}
    >
      <MakerOwnerScreen />
    </PreviewFrame>
  );
}
