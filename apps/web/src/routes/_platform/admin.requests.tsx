import { createFileRoute } from "@tanstack/react-router";

import { RouteStub } from "@/shared/components/route-stub";

export const Route = createFileRoute("/_platform/admin/requests")({
  component: () => <RouteStub titleKey="nav.adminRequests" />,
});
