import { createFileRoute } from "@tanstack/react-router";

import { FurnacesPage } from "@/features/foundry/masters-view";

export const Route = createFileRoute("/_tenant/masters/furnaces")({
  component: FurnacesPage,
});
