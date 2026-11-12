import { createFileRoute } from "@tanstack/react-router";

import { IngestReviewScreen } from "@/features/ingest/components/review-screen";
import { IngestAccess } from "@/features/ingest/components/shared";

export const Route = createFileRoute("/_tenant/ingest/review/$candidateId")({
  component: IngestReviewRoute,
});

function IngestReviewRoute() {
  const { candidateId } = Route.useParams();
  return (
    <IngestAccess>
      <IngestReviewScreen candidateId={candidateId} />
    </IngestAccess>
  );
}
