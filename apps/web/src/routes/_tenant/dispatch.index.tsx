import { createFileRoute } from "@tanstack/react-router";

import { RouteStub } from "@/shared/components/route-stub";

export const Route = createFileRoute("/_tenant/dispatch/")({
  component: () => <RouteStub titleKey="dispatch.title" />,
});
