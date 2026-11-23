import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "@/features/billing/settings-page";

export const Route = createFileRoute("/_tenant/billing/settings")({
  component: SettingsPage,
});
