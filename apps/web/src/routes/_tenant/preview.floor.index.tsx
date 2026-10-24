import { createFileRoute } from "@tanstack/react-router";

import { FloorLinks } from "@/features/preview/floor/floor-links";
import { PackStation } from "@/features/preview/floor/pack-station";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("floor")!;

export const Route = createFileRoute("/_tenant/preview/floor/")({
  component: FloorPreview,
});

function FloorPreview() {
  return (
    <PreviewFrame
      title="Pack"
      summary="Trolley 2 is on the bay. Pieces are typed. The scale fills the weight."
      featureIds={["FP-PK-01", "FP-PK-02", "FP-PK-03", "FP-PK-04", "FP-PK-05", "FP-PK-14"]}
      specPath={mod.specPath}
      actions={<FloorLinks current="pack" />}
    >
      <PackStation />
    </PreviewFrame>
  );
}
