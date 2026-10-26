import { createFileRoute } from "@tanstack/react-router";

import { MakersPage } from "@/features/die-room/makers-page";

export const Route = createFileRoute("/_tenant/dies/makers")({
  component: MakersPage,
});
