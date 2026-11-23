import { createFileRoute } from "@tanstack/react-router";

import { PortalComplaintsPage } from "@/features/complaints/portal-complaints";

export const Route = createFileRoute("/_portal/portal/complaints/")({
  component: PortalComplaintsPage,
});
