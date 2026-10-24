import { createFileRoute } from "@tanstack/react-router";

import { LanguageToggle, useChrome } from "@/features/preview/platform/chrome";
import { SettingsScreen } from "@/features/preview/platform/settings-screen";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("platform")!;

export const Route = createFileRoute("/_tenant/preview/platform/settings")({
  component: SettingsPreview,
});

function SettingsPreview() {
  const chrome = useChrome();
  return (
    <PreviewFrame
      title={chrome.settings}
      summary="Shifts, bought modules, commercial switches, standards and backup."
      featureIds={["FP-PF-05", "FP-PF-06", "FP-PF-07", "FP-PF-08", "FP-PF-09", "FP-PF-12"]}
      specPath={mod.specPath}
      actions={<LanguageToggle />}
    >
      <SettingsScreen />
    </PreviewFrame>
  );
}
