import { createFileRoute } from "@tanstack/react-router";

import { FloorLinks } from "@/features/preview/floor/floor-links";
import { StockYard } from "@/features/preview/floor/stock-yard";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("floor")!;

export const Route = createFileRoute("/_tenant/preview/floor/stock")({
  component: StockPreview,
});

function StockPreview() {
  return (
    <PreviewFrame
      title="Stock"
      summary="In the yard by die and cut length. A transfer does not move the kg."
      featureIds={["FP-PK-08", "FP-PK-09"]}
      specPath={mod.specPath}
      actions={<FloorLinks current="stock" />}
    >
      <StockYard />
    </PreviewFrame>
  );
}
