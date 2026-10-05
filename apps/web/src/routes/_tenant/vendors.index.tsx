import { createFileRoute } from "@tanstack/react-router";

import { VendorsPage, type VendorsSearch } from "@/features/masters/vendors-page";

const STATUSES = ["draft", "archived", "merged"] as const;

/** `?q=<name or spelling>&status=draft|archived|merged&offset=50`. */
export const Route = createFileRoute("/_tenant/vendors/")({
  validateSearch: (search: Record<string, unknown>): VendorsSearch => {
    const out: VendorsSearch = {};
    if (typeof search.q === "string" && search.q.trim()) out.q = search.q.trim().slice(0, 120);
    if (typeof search.status === "string" && (STATUSES as readonly string[]).includes(search.status)) {
      out.status = search.status as VendorsSearch["status"];
    }
    const offset = Number(search.offset);
    if (Number.isInteger(offset) && offset > 0) out.offset = offset;
    return out;
  },
  component: VendorsRoute,
});

function VendorsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <VendorsPage search={search} onSearch={(next) => void navigate({ search: next })} />;
}
