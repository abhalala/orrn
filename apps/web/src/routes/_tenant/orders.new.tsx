import { createFileRoute } from "@tanstack/react-router";

import { NewOrderPage } from "@/features/orders/new-order-page";

export const Route = createFileRoute("/_tenant/orders/new")({
  component: NewOrderPage,
});
