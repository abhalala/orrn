import { createFileRoute } from "@tanstack/react-router";

import { AlloysPage } from "@/features/foundry/masters-view";

export const Route = createFileRoute("/_tenant/masters/alloys")({
  component: AlloysPage,
});
