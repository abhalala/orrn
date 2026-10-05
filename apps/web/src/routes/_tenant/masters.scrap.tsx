import { createFileRoute } from "@tanstack/react-router";

import { SCRAP_TABS, ScrapPage, type ScrapTab } from "@/features/masters/scrap-page";

/** `?tab=items|grades|streams` (items when missing or unknown). */
export const Route = createFileRoute("/_tenant/masters/scrap")({
  validateSearch: (search: Record<string, unknown>): { tab?: ScrapTab } =>
    typeof search.tab === "string" && (SCRAP_TABS as readonly string[]).includes(search.tab) && search.tab !== "items"
      ? { tab: search.tab as ScrapTab }
      : {},
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
