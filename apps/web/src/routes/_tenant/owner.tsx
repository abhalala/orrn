import { createFileRoute } from "@tanstack/react-router";

import { OwnerPage } from "@/features/owner/owner-page";
import { parseOwnerSearch, type OwnerSearch } from "@/features/owner/search";

/** The owner's morning page: `?day=YYYY-MM-DD` picks the production day (default: the server's, yesterday). */
export const Route = createFileRoute("/_tenant/owner")({
  validateSearch: (search: Record<string, unknown>): OwnerSearch => parseOwnerSearch(search),
  component: OwnerRoute,
});

function OwnerRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <OwnerPage search={search} onSearch={(next) => void navigate({ search: next as never, replace: true })} />;
}
