import { createFileRoute } from "@tanstack/react-router";

import { parseVendorsSearch } from "@/features/masters/search";
import { VendorsPage } from "@/features/masters/vendors-page";

/** `?q=<name or spelling>&status=draft|archived|merged&offset=50`. */
export const Route = createFileRoute("/_tenant/vendors/")({
  validateSearch: parseVendorsSearch,
  component: VendorsRoute,
});

function VendorsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <VendorsPage search={search} onSearch={(next) => void navigate({ search: next })} />;
}
