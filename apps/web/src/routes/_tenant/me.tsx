import { createFileRoute } from "@tanstack/react-router";

import { MePage } from "@/features/me/me-page";

export const Route = createFileRoute("/_tenant/me")({
  component: MePage,
});
