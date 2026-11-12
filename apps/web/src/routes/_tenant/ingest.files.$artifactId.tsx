import { createFileRoute } from "@tanstack/react-router";

import { IngestFileScreen } from "@/features/ingest/components/file-screen";
import { IngestAccess } from "@/features/ingest/components/shared";

export const Route = createFileRoute("/_tenant/ingest/files/$artifactId")({
  component: IngestFileRoute,
});

function IngestFileRoute() {
  const { artifactId } = Route.useParams();
  return (
    <IngestAccess>
      <IngestFileScreen artifactId={artifactId} />
    </IngestAccess>
  );
}
