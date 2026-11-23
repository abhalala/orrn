import { createFileRoute } from "@tanstack/react-router";

import { AssetPage } from "@/features/maintenance/asset-page";

export const Route = createFileRoute("/_tenant/maintenance/assets/$id")({
  component: AssetRoute,
});

function AssetRoute() {
  const { id } = Route.useParams();
  return <AssetPage key={id} id={id} />;
}
