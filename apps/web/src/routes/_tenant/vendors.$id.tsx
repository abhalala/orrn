import { createFileRoute } from "@tanstack/react-router";

import { VendorPage } from "@/features/masters/vendor-page";

export const Route = createFileRoute("/_tenant/vendors/$id")({
  component: VendorRoute,
});

function VendorRoute() {
  const { id } = Route.useParams();
  // Keyed so moving between vendors (after a merge) starts each page fresh.
  return <VendorPage key={id} id={id} />;
}
