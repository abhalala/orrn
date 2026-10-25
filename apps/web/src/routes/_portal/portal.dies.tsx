import { createFileRoute } from "@tanstack/react-router";

import { PortalDiesPage } from "@/features/portal/dies-page";

export const Route = createFileRoute("/_portal/portal/dies")({
  component: PortalDiesPage,
});
