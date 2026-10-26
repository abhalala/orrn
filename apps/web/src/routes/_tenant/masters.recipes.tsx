import { createFileRoute } from "@tanstack/react-router";

import { RecipesPage } from "@/features/ageing/masters-pages";

export const Route = createFileRoute("/_tenant/masters/recipes")({
  component: RecipesPage,
});
