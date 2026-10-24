import { createFileRoute } from "@tanstack/react-router";

import { CertificateScreen } from "@/features/preview/foundry/components/certificate-screen";
import { CERTIFICATE_FEATURE_IDS } from "@/features/preview/foundry/fixtures";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("foundry")!;

export const Route = createFileRoute("/_tenant/preview/foundry/certificate")({
  component: FoundryCertificatePreview,
});

function FoundryCertificatePreview() {
  return (
    <PreviewFrame
      title="Test certificate"
      summary="Staff print for cast K31. Not a tax invoice."
      featureIds={[...CERTIFICATE_FEATURE_IDS]}
      specPath={mod.specPath}
    >
      <CertificateScreen />
    </PreviewFrame>
  );
}
