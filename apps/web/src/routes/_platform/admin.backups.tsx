import { createFileRoute } from "@tanstack/react-router";

import { BackupsPage } from "@/features/admin/backups-page";

export const Route = createFileRoute("/_platform/admin/backups")({
  component: BackupsPage,
});
