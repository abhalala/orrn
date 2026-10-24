import { createFileRoute } from "@tanstack/react-router";

import { LotsPage, isLotFilter, type LotFilter } from "@/features/purchase/lots-page";

type PurchaseSearch = { status?: Exclude<LotFilter, "all"> };

export const Route = createFileRoute("/_tenant/purchase/")({
  validateSearch: (search: Record<string, unknown>): PurchaseSearch =>
    isLotFilter(search.status) && search.status !== "all" ? { status: search.status } : {},
  component: PurchaseRoute,
});

function PurchaseRoute() {
  const { status } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <LotsPage
      filter={status ?? "all"}
      onFilter={(f) => navigate({ search: f === "all" ? {} : { status: f }, replace: true })}
    />
  );
}
