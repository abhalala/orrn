import { createFileRoute } from "@tanstack/react-router";

import { PlanBoardPage } from "@/features/orders/plan-board-page";

export const Route = createFileRoute("/_tenant/orders/plan/")({
  component: PlanBoardPage,
});
