import { createFileRoute } from "@tanstack/react-router";

import { NewCastScreen } from "@/features/foundry/new-cast-view";

export const Route = createFileRoute("/_tenant/casts/new")({
  component: NewCastScreen,
});
