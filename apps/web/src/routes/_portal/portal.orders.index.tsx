import { createFileRoute } from "@tanstack/react-router";

import { PortalOrdersPage } from "@/features/portal/orders-page";

export const Route = createFileRoute("/_portal/portal/orders/")({
  component: PortalOrdersPage,
});
