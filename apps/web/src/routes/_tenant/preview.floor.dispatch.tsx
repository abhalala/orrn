import { createFileRoute } from "@tanstack/react-router";

import { DispatchScan } from "@/features/preview/floor/dispatch-scan";
import { FloorLinks } from "@/features/preview/floor/floor-links";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("floor")!;

export const Route = createFileRoute("/_tenant/preview/floor/dispatch")({
  component: DispatchPreview,
});

function DispatchPreview() {
  return (
    <PreviewFrame
      title="Dispatch"
      summary="Scan labels onto the load. A full truck warns. It does not refuse the scan."
      featureIds={["FP-PK-11", "FP-PK-12", "FP-PK-15", "FP-PK-10"]}
      specPath={mod.specPath}
      actions={<FloorLinks current="dispatch" />}
    >
      <DispatchScan />
    </PreviewFrame>
  );
}
