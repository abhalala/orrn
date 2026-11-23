import { createFileRoute } from "@tanstack/react-router";

import { RejectionsReport } from "@/features/reports/reg-rejections";
import { parseRejectionsSearch } from "@/features/reports/reg-search";

export const Route = createFileRoute("/_tenant/reports/rejections")({
  validateSearch: (raw: Record<string, unknown>) => parseRejectionsSearch(raw),
  component: RejectionsReportRoute,
});

function RejectionsReportRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <RejectionsReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
