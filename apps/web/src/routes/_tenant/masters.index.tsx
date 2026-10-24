import { createFileRoute } from "@tanstack/react-router";

import { MastersHubPage } from "@/features/masters/hub-page";

export const Route = createFileRoute("/_tenant/masters/")({
  component: MastersHubPage,
});
