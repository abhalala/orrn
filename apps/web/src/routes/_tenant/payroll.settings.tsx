import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "@/features/payroll/settings-page";

export const Route = createFileRoute("/_tenant/payroll/settings")({
  component: SettingsPage,
});
