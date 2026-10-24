import { createFileRoute } from "@tanstack/react-router";

import { ScrapPage } from "@/features/masters/scrap-page";
import { parseScrapSearch } from "@/features/masters/search";

/** `?tab=items|grades|streams` (items when missing or unknown). */
export const Route = createFileRoute("/_tenant/masters/scrap")({
  validateSearch: parseScrapSearch,
  component: ScrapRoute,
});

function ScrapRoute() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ScrapPage
      tab={tab ?? "items"}
      onTab={(next) => void navigate({ search: next === "items" ? {} : { tab: next }, replace: true })}
    />
  );
}
