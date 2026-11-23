import { createFileRoute } from "@tanstack/react-router";

import { DevicesPage } from "@/features/hr/devices-page";

export const Route = createFileRoute("/_tenant/hr/devices")({
  component: DevicesPage,
});
