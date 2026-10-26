import { createFileRoute } from "@tanstack/react-router";

import { legacyRedirect } from "@/shared/lib/legacy-redirect";

/** Old URL: redirects to its C2 home with the query kept (spec §3.2, `shared/lib/redirects.ts`). */
export const Route = createFileRoute("/_public/waitlist")({
  beforeLoad: ({ location }) => {
    throw legacyRedirect(location);
  },
});
