import { createFileRoute } from "@tanstack/react-router";

import { DrawbenchScreen } from "@/features/jobwork/kind-screen";

/** `/drawbench`: the draw bench steps and a start form. A step opens on `/jobwork/$id`. */
export const Route = createFileRoute("/_tenant/drawbench/")({
  component: DrawbenchScreen,
});
