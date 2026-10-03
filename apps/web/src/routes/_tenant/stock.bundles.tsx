import { createFileRoute } from "@tanstack/react-router";

import { RouteStub } from "@/shared/components/route-stub";

export const Route = createFileRoute("/_tenant/stock/bundles")({
  component: () => <RouteStub titleKey="stock.list.title" />,
});
