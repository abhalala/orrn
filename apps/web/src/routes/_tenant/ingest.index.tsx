import { createFileRoute } from "@tanstack/react-router";

import { IngestAccess } from "@/features/ingest/components/shared";
import { IngestUploadScreen } from "@/features/ingest/components/upload-screen";

export const Route = createFileRoute("/_tenant/ingest/")({
  component: IngestIndexRoute,
});

function IngestIndexRoute() {
  return (
    <IngestAccess>
      <IngestUploadScreen />
    </IngestAccess>
  );
}
