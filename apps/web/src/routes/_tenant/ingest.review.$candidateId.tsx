import { createFileRoute } from "@tanstack/react-router";

import { IngestCheckReviewScreen } from "@/features/ingest/components/check-screens";
import { IngestReviewScreen } from "@/features/ingest/components/review-screen";
import { IngestAccess } from "@/features/ingest/components/shared";
import { ingestAccessOf } from "@/features/ingest/lib";
import { useMe } from "@/shared/lib/me";

export const Route = createFileRoute("/_tenant/ingest/review/$candidateId")({
  component: IngestReviewRoute,
});

/** Item 16: a person with `ingest.check` only gets the read-only page check of a model-read table and its tick. */
function IngestReviewRoute() {
  const { candidateId } = Route.useParams();
  const { data: me } = useMe();
  if (ingestAccessOf(me) === "check") return <IngestCheckReviewScreen candidateId={candidateId} />;
  return (
    <IngestAccess>
      <IngestReviewScreen candidateId={candidateId} />
    </IngestAccess>
  );
}
