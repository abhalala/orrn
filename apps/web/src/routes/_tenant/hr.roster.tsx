import { createFileRoute } from "@tanstack/react-router";

import { RosterPage } from "@/features/hr/roster-page";

export const Route = createFileRoute("/_tenant/hr/roster")({
  component: RosterPage,
});
