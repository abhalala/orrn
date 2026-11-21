import { createFileRoute } from "@tanstack/react-router";

import { IngestCheckListScreen } from "@/features/ingest/components/check-screens";
import { IngestAccess } from "@/features/ingest/components/shared";
import { IngestUploadScreen } from "@/features/ingest/components/upload-screen";
import { ingestAccessOf } from "@/features/ingest/lib";
import { useMe } from "@/shared/lib/me";

export const Route = createFileRoute("/_tenant/ingest/")({
  component: IngestIndexRoute,
});

/** Item 16: a person with `ingest.check` only sees the tables waiting for a check; upload stays behind `ingest.upload`. */
function IngestIndexRoute() {
  const { data: me } = useMe();
  if (ingestAccessOf(me) === "check") return <IngestCheckListScreen />;
  return (
    <IngestAccess>
      <IngestUploadScreen />
    </IngestAccess>
  );
}
