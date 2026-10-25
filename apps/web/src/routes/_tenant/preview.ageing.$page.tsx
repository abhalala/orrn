import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Retired fixture demo (2026-10-25): `/preview/ageing/batch`, `/report` and `/masters`. The real screens live
 * at the redirect targets; any other page goes to the board. One route for the three keeps the entry small.
 */
export const Route = createFileRoute("/_tenant/preview/ageing/$page")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: params.page === "report" ? "/reports/ageing" : params.page === "masters" ? "/masters/ovens" : "/ageing" });
  },
});
