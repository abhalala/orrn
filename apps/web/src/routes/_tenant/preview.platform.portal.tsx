import { createFileRoute } from "@tanstack/react-router";

import { DieAccessDemo, LanguageToggle } from "@/features/preview/platform/chrome";
import { BHAVESH } from "@/features/preview/platform/fixtures";
import { PortalScreen } from "@/features/preview/platform/portal-screen";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("platform")!;

export const Route = createFileRoute("/_tenant/preview/platform/portal")({
  component: PortalPreview,
});

function PortalPreview() {
  return (
    <PreviewFrame
      title={BHAVESH.name}
      summary={`${BHAVESH.city} · party portal. Not the plant.`}
      featureIds={["FP-PF-01", "FP-PF-02", "FP-PF-03", "FP-PF-04", "FP-PF-06"]}
      specPath={mod.specPath}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <LanguageToggle />
          <DieAccessDemo />
        </div>
      }
    >
      <PortalScreen />
    </PreviewFrame>
  );
}
