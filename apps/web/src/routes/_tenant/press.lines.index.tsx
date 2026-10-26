import { createFileRoute } from "@tanstack/react-router";

import { LinesMaster } from "@/features/press/lines-master";

export const Route = createFileRoute("/_tenant/press/lines/")({
  component: LinesMaster,
});
