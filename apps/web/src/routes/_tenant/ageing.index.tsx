import { createFileRoute } from "@tanstack/react-router";

import { BoardScreen } from "@/features/ageing/board-view";

export const Route = createFileRoute("/_tenant/ageing/")({
  component: BoardScreen,
});
