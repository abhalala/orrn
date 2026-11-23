import { createFileRoute } from "@tanstack/react-router";

import { AssetsPage } from "@/features/maintenance/assets-page";

export const Route = createFileRoute("/_tenant/maintenance/assets/")({
  component: AssetsPage,
});
