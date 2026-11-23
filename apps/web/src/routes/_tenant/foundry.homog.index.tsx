import { createFileRoute } from "@tanstack/react-router";

import { HomogListScreen } from "@/features/foundry/homog-list-view";

/** `/foundry/homog`: homogenizing batches. */
export const Route = createFileRoute("/_tenant/foundry/homog/")({
  component: HomogListScreen,
});
