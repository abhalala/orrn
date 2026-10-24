import { createFileRoute } from "@tanstack/react-router";

import { FloorLinks } from "@/features/preview/floor/floor-links";
import { PackingListView } from "@/features/preview/floor/packing-list-view";
import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";

const mod = previewModule("floor")!;

export const Route = createFileRoute("/_tenant/preview/floor/list")({
  component: ListPreview,
});

function ListPreview() {
  return (
    <PreviewFrame
      title="Packing list"
      summary="Section order, a revision that is kept, and the party's own bundle numbers."
      featureIds={["FP-PK-13", "FP-PK-05", "FP-PK-07"]}
      specPath={mod.specPath}
      actions={<FloorLinks current="list" />}
    >
      <PackingListView />
    </PreviewFrame>
  );
}
