import { createFileRoute } from "@tanstack/react-router";

import { NewScreen } from "@/features/jobwork/new-view";

/** `/jobwork/new`: a new challan to a vendor, or an in-house step on the finishing line. */
export const Route = createFileRoute("/_tenant/jobwork/new")({
  component: NewScreen,
});
