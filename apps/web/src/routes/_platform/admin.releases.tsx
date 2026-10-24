import { createFileRoute } from "@tanstack/react-router";

import { ReleasesPage } from "@/features/admin/releases-page";

export const Route = createFileRoute("/_platform/admin/releases")({
  component: ReleasesPage,
});
