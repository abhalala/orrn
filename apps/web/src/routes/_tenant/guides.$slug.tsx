import { createFileRoute } from "@tanstack/react-router";

import { RouteStub } from "@/shared/components/route-stub";

export const Route = createFileRoute("/_tenant/guides/$slug")({
  component: () => <RouteStub titleKey="guides.title" />,
});
