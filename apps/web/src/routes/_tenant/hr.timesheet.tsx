import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { timesheetSearch } from "@/features/hr/search";
import { TimesheetPage } from "@/features/hr/timesheet-page";

export const Route = createFileRoute("/_tenant/hr/timesheet")({
  validateSearch: timesheetSearch,
  component: TimesheetRoute,
});

function TimesheetRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/hr/timesheet" });
  return <TimesheetPage search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
