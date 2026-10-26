import { createFileRoute } from "@tanstack/react-router";

import { PortalNewOrderPage } from "@/features/portal/new-order-page";

export const Route = createFileRoute("/_portal/portal/orders/new")({
  component: PortalNewOrderPage,
});
