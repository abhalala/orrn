import { createFileRoute } from "@tanstack/react-router";

import { LogsScreen } from "@/features/foundry/logs-view";

/** `/foundry/logs`: bought-in log receipts. */
export const Route = createFileRoute("/_tenant/foundry/logs")({
  component: LogsScreen,
});
