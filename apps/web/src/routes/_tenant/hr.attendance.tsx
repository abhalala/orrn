import { createFileRoute } from "@tanstack/react-router";

import { AttendancePage } from "@/features/hr/attendance-page";

export const Route = createFileRoute("/_tenant/hr/attendance")({
  component: AttendancePage,
});
