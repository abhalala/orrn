import { createFileRoute } from "@tanstack/react-router";

import { ComplaintsPage } from "@/features/complaints/complaints-page";
import { parseComplaintSearch, type ComplaintSearch } from "@/features/complaints/model";

/** The register's status filter lives in the URL: `?status=replied` (active is the default and is left out). */
export const Route = createFileRoute("/_tenant/complaints/")({
  validateSearch: (search: Record<string, unknown>): ComplaintSearch => parseComplaintSearch(search),
  component: ComplaintsRoute,
});

function ComplaintsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <ComplaintsPage search={search} onSearch={(next) => void navigate({ search: next as never, replace: true })} />;
}
