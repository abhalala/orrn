import { createFileRoute } from "@tanstack/react-router";

import { LoadScreen } from "@/features/ageing/load-view";
import { parseLoadSearch } from "@/features/ageing/search";

export const Route = createFileRoute("/_tenant/ageing/load")({
  component: LoadRoute,
});

function LoadRoute() {
  return <LoadScreen search={parseLoadSearch(Route.useSearch() as Record<string, unknown>)} />;
}
