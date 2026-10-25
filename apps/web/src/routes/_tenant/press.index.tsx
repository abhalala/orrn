import { createFileRoute } from "@tanstack/react-router";

import { LineBoard } from "@/features/press/line-board";

export const Route = createFileRoute("/_tenant/press/")({
  component: LineBoard,
});
