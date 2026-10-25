import { createFileRoute } from "@tanstack/react-router";

import { DieSharePage } from "@/features/die-room/share-page";

/**
 * `/share/die/$token` (FP-DR-20): the page a party opens from a die share link. Outside `_tenant` and
 * `_authed` on purpose: no sign-in, no app shell, no company data beyond what the link allows. The
 * token never goes to the search engines or to the sites the drawing links to.
 */
export const Route = createFileRoute("/share/die/$token")({
  head: () => ({
    meta: [{ title: "ORRN" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }],
  }),
  component: ShareRoute,
});

function ShareRoute() {
  const { token } = Route.useParams();
  return <DieSharePage token={token} />;
}
