import { createFileRoute } from "@tanstack/react-router";

import { QaScreen } from "@/features/qa/qa-screen";
import { parseQaSearch } from "@/features/qa/search";

/** `/qa?tab=waiting|holds|checks|instruments|lists|settings` (XE parity lane QA); waiting when missing. */
export const Route = createFileRoute("/_tenant/qa")({
  validateSearch: (raw: Record<string, unknown>) => parseQaSearch(raw),
  component: QaRoute,
});

function QaRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <QaScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
