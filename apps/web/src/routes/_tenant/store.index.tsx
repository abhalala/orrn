import { createFileRoute } from "@tanstack/react-router";

import { StorePage } from "@/features/store/store-page";

export const Route = createFileRoute("/_tenant/store/")({
  component: StorePage,
});
