import { createFileRoute } from "@tanstack/react-router";

import { TrainingPage } from "@/features/hr/training-page";

export const Route = createFileRoute("/_tenant/hr/training")({
  component: TrainingPage,
});
