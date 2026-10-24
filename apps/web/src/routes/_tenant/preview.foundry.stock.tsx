import { createFileRoute } from "@tanstack/react-router";

import { StockScreen } from "@/features/preview/foundry/components/stock-screen";
import { STOCK_FEATURE_IDS } from "@/features/preview/foundry/fixtures";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("foundry")!;

export const Route = createFileRoute("/_tenant/preview/foundry/stock")({
  component: FoundryStockPreview,
});

function FoundryStockPreview() {
  return (
    <PreviewFrame
      title="Billet stock"
      summary="On hand and credited, by alloy and cast."
      featureIds={[...STOCK_FEATURE_IDS]}
      specPath={mod.specPath}
    >
      <StockScreen />
    </PreviewFrame>
  );
}
