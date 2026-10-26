import { createFileRoute } from "@tanstack/react-router";

import { InboxScreen } from "@/features/foundry/inbox-view";
import { parseInboxSearch } from "@/features/foundry/search";

/** `/casts/inbox?tab=arriving|handled` (waiting files when missing). */
export const Route = createFileRoute("/_tenant/casts/inbox")({
  validateSearch: (raw: Record<string, unknown>) => parseInboxSearch(raw),
  component: InboxRoute,
});

function InboxRoute() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <InboxScreen tab={tab ?? "waiting"} onTab={(next) => void navigate({ search: next === "waiting" ? {} : { tab: next }, replace: true })} />;
}
