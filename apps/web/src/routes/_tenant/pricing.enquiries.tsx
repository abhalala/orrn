import { createFileRoute } from "@tanstack/react-router";

import { EnquiriesPage } from "@/features/pricing/docs/enquiries-page";
import { parseEnquiriesSearch } from "@/features/pricing/docs/search";

/** Enquiries: open by default; `?overdue=1` (the Today tile) or `?view=all`. */
export const Route = createFileRoute("/_tenant/pricing/enquiries")({
  validateSearch: (search: Record<string, unknown>) => parseEnquiriesSearch(search),
  component: EnquiriesRoute,
});

function EnquiriesRoute() {
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <EnquiriesPage view={view ?? "open"} onView={(next) => void navigate({ search: next === "open" ? {} : { view: next }, replace: true })} />;
}
