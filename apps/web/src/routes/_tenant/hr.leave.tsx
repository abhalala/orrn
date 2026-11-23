import { createFileRoute } from "@tanstack/react-router";

import { LeavePage } from "@/features/hr/leave-page";

export const Route = createFileRoute("/_tenant/hr/leave")({
  component: LeavePage,
});
