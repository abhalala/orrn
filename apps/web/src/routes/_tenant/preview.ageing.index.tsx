import { createFileRoute } from "@tanstack/react-router";

import { AgeingBoard } from "@/features/preview/ageing/board";

export const Route = createFileRoute("/_tenant/preview/ageing/")({
  component: AgeingBoard,
});
