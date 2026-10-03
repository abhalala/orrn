import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/today` is the post-login home (`homeFor`). The real screen arrives with the
 * route-map task, which replaces this file; until then it forwards to the
 * existing dashboard. It sits under `_tenant`, so the layout guard runs first
 * and a signed-out visit still lands on `/login?next=%2Ftoday`.
 */
export const Route = createFileRoute("/_tenant/today")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", replace: true });
  },
});
