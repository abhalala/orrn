import { createFileRoute } from "@tanstack/react-router";

import { RouteStub } from "@/shared/components/route-stub";

export const Route = createFileRoute("/_tenant/pack/new")({
  component: () => <RouteStub titleKey="pack.newSession" />,
});
