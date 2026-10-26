import { createFileRoute } from "@tanstack/react-router";

import { NewLotPage } from "@/features/purchase/new-lot-page";

export const Route = createFileRoute("/_tenant/purchase/new")({
  component: NewLotPage,
});
