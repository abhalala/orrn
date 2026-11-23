import { createFileRoute } from "@tanstack/react-router";

import { RunPage } from "@/features/payroll/run-page";

export const Route = createFileRoute("/_tenant/payroll/$month")({
  component: RunRoute,
});

function RunRoute() {
  const { month } = Route.useParams();
  return <RunPage key={month} month={month} />;
}
