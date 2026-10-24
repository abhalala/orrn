import { createFileRoute } from "@tanstack/react-router";

import { SupportPage } from "@/features/admin/support-page";

export const Route = createFileRoute("/_platform/admin/support")({
  component: SupportPage,
});
