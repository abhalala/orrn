import { createFileRoute } from "@tanstack/react-router";

import { PortalTodayPage } from "@/features/portal/today-page";

export const Route = createFileRoute("/_portal/portal/")({
  component: PortalTodayPage,
});
