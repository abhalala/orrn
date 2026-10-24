import { createFileRoute } from "@tanstack/react-router";

import { LanguageToggle } from "@/features/preview/platform/chrome";
import { DevicesScreen } from "@/features/preview/platform/devices-screen";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("platform")!;

export const Route = createFileRoute("/_tenant/preview/platform/devices")({
  component: DevicesPreview,
});

function DevicesPreview() {
  return (
    <PreviewFrame
      title="Devices"
      summary="Phones and tablets on in.orrn.app, and the update gate."
      featureIds={["FP-PF-11", "FP-PF-13"]}
      specPath={mod.specPath}
      actions={<LanguageToggle />}
    >
      <DevicesScreen />
    </PreviewFrame>
  );
}
