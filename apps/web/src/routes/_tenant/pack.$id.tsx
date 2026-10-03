import { createFileRoute } from "@tanstack/react-router";

import { RouteStub } from "@/shared/components/route-stub";

export const Route = createFileRoute("/_tenant/pack/$id")({
  component: () => <RouteStub titleKey="pack.title" />,
});
