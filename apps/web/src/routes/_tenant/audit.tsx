import { createFileRoute } from "@tanstack/react-router";

import { AuditScreen } from "@/features/audit/audit-screen";
import { parseAuditSearch, type AuditFilters } from "@/features/audit/model";

export const Route = createFileRoute("/_tenant/audit")({
  // Plain checks (no zod): route options sit in the entry chunk every page loads.
  validateSearch: (search: Record<string, unknown>): AuditFilters => parseAuditSearch(search),
  component: AuditPage,
});

function AuditPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <AuditScreen filters={search} onFilters={(next) => void navigate({ search: next, replace: true })} />;
}
