import { createFileRoute, redirect } from "@tanstack/react-router";

import { ChoosePlantPage } from "@/features/auth/choose-plant-page";
import { choosePlantSearch } from "@/features/auth/plant-choice";
import { homeTarget, needsPassword } from "@/shared/lib/home";

/**
 * "Choose a plant" (plan 2026-11-18, Task 9): where a person in more than one active plant lands after
 * every sign-in (`homeFor`), and where /welcome's "Choose another plant" leads. Anyone with one plant,
 * an open password chore or an impersonation grant goes to their own home instead. `?next=` is the
 * page they signed in for (same-origin only), opened once the plant is set up.
 */
export const Route = createFileRoute("/_authed/choose-plant")({
  validateSearch: choosePlantSearch,
  beforeLoad: ({ context }) => {
    const { me } = context;
    if (needsPassword(me) || !me.company || me.impersonation || (me.memberships?.length ?? 0) <= 1) {
      throw redirect({ to: homeTarget(me), replace: true });
    }
  },
  component: ChoosePlantRoute,
});

function ChoosePlantRoute() {
  const { me } = Route.useRouteContext();
  const { next } = Route.useSearch();
  return <ChoosePlantPage me={me} next={next} />;
}
