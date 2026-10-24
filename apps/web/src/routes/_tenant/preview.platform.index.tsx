import { createFileRoute } from "@tanstack/react-router";

import { LanguageToggle, useChrome } from "@/features/preview/platform/chrome";
import { PLANT } from "@/features/preview/platform/fixtures";
import { TodayScreen } from "@/features/preview/platform/today-screen";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("platform")!;

export const Route = createFileRoute("/_tenant/preview/platform/")({
  component: PlatformPreview,
});

function PlatformPreview() {
  const chrome = useChrome();
  return (
    <PreviewFrame
      title={chrome.today}
      summary={`${PLANT.name}, ${PLANT.city}. Owner view for this production day.`}
      featureIds={["FP-PF-05", "FP-PF-13", "FP-PF-15"]}
      specPath={mod.specPath}
      actions={<LanguageToggle />}
    >
      <TodayScreen />
    </PreviewFrame>
  );
}
