import { createFileRoute } from "@tanstack/react-router";

import { MaintenanceHome } from "@/features/maintenance/home-page";

export const Route = createFileRoute("/_tenant/maintenance/")({
  component: MaintenanceHome,
});
