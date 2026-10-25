import { createFileRoute, redirect } from "@tanstack/react-router";

/** Retired fixture demo (2026-10-25). The real screen lives at the redirect target. */
export const Route = createFileRoute("/_tenant/preview/orders/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/orders/$id", params: { id: params.id } });
  },
});
