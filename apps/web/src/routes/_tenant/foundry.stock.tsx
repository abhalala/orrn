import { createFileRoute } from "@tanstack/react-router";

import { FoundryStockScreen } from "@/features/foundry/stock-view";

export const Route = createFileRoute("/_tenant/foundry/stock")({
  component: FoundryStockScreen,
});
