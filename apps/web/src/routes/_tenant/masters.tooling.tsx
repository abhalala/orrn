import { createFileRoute } from "@tanstack/react-router";

import { ToolingPage } from "@/features/masters/tooling-page";

export const Route = createFileRoute("/_tenant/masters/tooling")({
  component: ToolingPage,
});
