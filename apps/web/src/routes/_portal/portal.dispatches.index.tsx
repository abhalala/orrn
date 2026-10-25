import { createFileRoute } from "@tanstack/react-router";

import { PortalDispatchesPage } from "@/features/portal/dispatches-page";

export const Route = createFileRoute("/_portal/portal/dispatches/")({
  component: PortalDispatchesPage,
});
