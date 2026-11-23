import { createFileRoute } from "@tanstack/react-router";

import { DataSheetScreen } from "@/features/foundry/data-sheet-view";

export const Route = createFileRoute("/_tenant/casts/$id/sheet")({
  component: DataSheetRoute,
});

function DataSheetRoute() {
  const { id } = Route.useParams();
  return <DataSheetScreen key={id} id={id} />;
}
