import { createFileRoute } from "@tanstack/react-router";

import { ChemistryScreen } from "@/features/foundry/chemistry-view";

export const Route = createFileRoute("/_tenant/foundry/chemistry")({
  component: ChemistryScreen,
});
