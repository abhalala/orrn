import { createFileRoute } from "@tanstack/react-router";

import { PeoplePage } from "@/features/hr/people-page";

export const Route = createFileRoute("/_tenant/hr/")({
  component: PeoplePage,
});
