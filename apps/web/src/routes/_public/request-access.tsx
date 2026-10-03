import { createFileRoute } from "@tanstack/react-router";

import { RouteStub } from "@/shared/components/route-stub";

export const Route = createFileRoute("/_public/request-access")({
  // The marketing buttons say which request they mean: a demo or the waitlist.
  validateSearch: (search: Record<string, unknown>): { mode?: "demo" | "waitlist" } =>
    search.mode === "demo" || search.mode === "waitlist" ? { mode: search.mode } : {},
  component: () => (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-16">
      <RouteStub titleKey="auth.requestAccess.title" />
    </main>
  ),
});
