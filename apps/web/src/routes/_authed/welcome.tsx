import { createFileRoute } from "@tanstack/react-router";

import { RouteStub } from "@/shared/components/route-stub";

export const Route = createFileRoute("/_authed/welcome")({
  component: () => <RouteStub titleKey="welcome.title" />,
});
