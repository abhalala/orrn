import { createFileRoute } from "@tanstack/react-router";

import { AgeingBatch } from "@/features/preview/ageing/batch";

export const Route = createFileRoute("/_tenant/preview/ageing/batch")({
  component: AgeingBatch,
});
