import { Button } from "@orrn/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { CastsScreen } from "@/features/preview/foundry/components/casts-screen";
import { CASTS_FEATURE_IDS } from "@/features/preview/foundry/fixtures";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("foundry")!;

export const Route = createFileRoute("/_tenant/preview/foundry/")({
  component: FoundryPreview,
});

function FoundryPreview() {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <PreviewFrame
      title={mod.title}
      summary="Open casts first. Fourcubes Extrusions, Surat, 24 Oct 2026."
      featureIds={[...CASTS_FEATURE_IDS]}
      specPath={mod.specPath}
      actions={<Button onClick={() => setSheetOpen(true)}>Open cast</Button>}
    >
      <CastsScreen sheetOpen={sheetOpen} onSheetOpenChange={setSheetOpen} />
    </PreviewFrame>
  );
}
