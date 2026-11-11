import { createFileRoute } from "@tanstack/react-router";

import { IngestMergeScreen } from "@/features/ingest/components/merge-screen";
import { IngestAccess } from "@/features/ingest/components/shared";

export const Route = createFileRoute("/_tenant/ingest/merge/$runId")({
  component: IngestMergeRoute,
});

function IngestMergeRoute() {
  const { runId } = Route.useParams();
  return (
    <IngestAccess>
      <IngestMergeScreen runId={runId} />
    </IngestAccess>
  );
}
