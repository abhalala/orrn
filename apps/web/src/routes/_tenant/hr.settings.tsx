import { createFileRoute } from "@tanstack/react-router";

import { HrSettingsPage } from "@/features/hr/settings-page";

export const Route = createFileRoute("/_tenant/hr/settings")({
  component: HrSettingsPage,
});
