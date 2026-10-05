import { createFileRoute } from "@tanstack/react-router";

import { DieCopiesPage, type DieCopiesSearch } from "@/features/masters/die-copies-page";
import { DIE_COPY_STATUSES, type DieCopyStatus } from "@/features/masters/masters-model";

/** `?section=<section id>&status=available|in_use|at_nitriding|retired&offset=50`. */
export const Route = createFileRoute("/_tenant/masters/dies")({
  validateSearch: (search: Record<string, unknown>): DieCopiesSearch => {
    const out: DieCopiesSearch = {};
    if (typeof search.section === "string" && search.section) out.section = search.section;
    if (typeof search.status === "string" && (DIE_COPY_STATUSES as readonly string[]).includes(search.status)) {
      out.status = search.status as DieCopyStatus;
    }
    const offset = Number(search.offset);
    if (Number.isInteger(offset) && offset > 0) out.offset = offset;
    return out;
  },
  component: DieCopiesRoute,
});

function DieCopiesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <DieCopiesPage search={search} onSearch={(next) => void navigate({ search: next })} />;
}
