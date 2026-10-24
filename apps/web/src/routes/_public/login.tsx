import { createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "@/shared/components/auth-screen";
import SignInForm from "@/shared/components/sign-in-form";

/**
 * `?next=` is the page to return to after sign-in (checked by safe-next before use). A plain
 * function, not a zod schema: validateSearch runs in the entry chunk, and zod there cost every
 * first visit to `/` about 18 kB gzip (AGENTS.md, web bundle).
 */
function loginSearch(search: Record<string, unknown>): { next?: string } {
  return typeof search.next === "string" ? { next: search.next } : {};
}

export const Route = createFileRoute("/_public/login")({
  component: RouteComponent,
  validateSearch: loginSearch,
});

function RouteComponent() {
  const { next } = Route.useSearch();

  return (
    <AuthScreen>
      <SignInForm next={next} />
    </AuthScreen>
  );
}
