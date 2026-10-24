import { createFileRoute } from "@tanstack/react-router";

import { IssuesPage } from "@/features/die-room/issues-page";

export const Route = createFileRoute("/_tenant/dies/issues")({
  component: IssuesPage,
});
