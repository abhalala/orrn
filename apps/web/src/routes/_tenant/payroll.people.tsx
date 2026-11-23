import { createFileRoute } from "@tanstack/react-router";

import { PeoplePage } from "@/features/payroll/people-page";

export const Route = createFileRoute("/_tenant/payroll/people")({
  component: PeoplePage,
});
