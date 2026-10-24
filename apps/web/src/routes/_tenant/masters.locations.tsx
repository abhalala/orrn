import { createFileRoute } from "@tanstack/react-router";

import { LocationsPage } from "@/features/masters/locations-page";

export const Route = createFileRoute("/_tenant/masters/locations")({
  component: LocationsPage,
});
