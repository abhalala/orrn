import { createFileRoute } from "@tanstack/react-router";

import { FabricationScreen } from "@/features/jobwork/kind-screen";

/** `/fabrication`: the fabrication steps and a start form. A step opens on `/jobwork/$id`. */
export const Route = createFileRoute("/_tenant/fabrication/")({
  component: FabricationScreen,
});
