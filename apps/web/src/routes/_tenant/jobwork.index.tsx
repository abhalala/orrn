import { createFileRoute } from "@tanstack/react-router";

import { JobworkScreen } from "@/features/jobwork/jobwork-page";

/** `/jobwork`: at vendors, the register, the in-house line and the vendors. The tab is local state: no `validateSearch` here. */
export const Route = createFileRoute("/_tenant/jobwork/")({
  component: JobworkScreen,
});
