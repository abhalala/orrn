import { loadMessages, isLocale } from "@orrn/i18n";
import { notFound, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { readStoredLocaleOrNull } from "./locale";
import { loadMe, toLogin } from "./guards";
import { needsPassword } from "./home";
import { pickPortalPlant, readPortalPlant, storePortalPlant } from "./portal-plant";
import { trpc } from "../utils/trpc";

type GuardArgs = { context: { queryClient: QueryClient }; location: { href: string } };

/**
 * Party portal door (`_portal` layout). Signed in with a password; a portal login in at least one
 * plant. A person with none gets Not found when they work in a plant (a plant member opening
 * `/portal`), else the plain no-access page. The plant the party reads is fixed before any portal
 * call, and its language loads before first paint.
 */
export async function requirePortal({ context, location }: GuardArgs) {
  const me = await loadMe(context.queryClient);
  if (!me) throw toLogin(location);
  if (needsPassword(me)) throw redirect({ to: "/welcome" });

  let plants: { companyId: string; companyName: string; customerName: string; portalEnabled: boolean }[] = [];
  try {
    plants = await context.queryClient.fetchQuery({ ...trpc.portal.access.queryOptions(), staleTime: 30_000, retry: false });
  } catch {
    plants = [];
  }
  if (plants.length === 0) {
    if (me.company || (me.memberships?.length ?? 0) > 0 || (me.isPlatformAdmin && me.platformRole)) throw notFound();
    throw redirect({ to: "/no-access", replace: true });
  }

  const chosen = pickPortalPlant(plants, readPortalPlant());
  if (chosen) storePortalPlant(chosen.companyId);

  // The party's language (set by the plant) loads before the page draws; a saved choice wins.
  try {
    const mine = await context.queryClient.fetchQuery({ ...trpc.portal.me.queryOptions(), staleTime: 60_000, retry: false });
    if (!readStoredLocaleOrNull() && isLocale(mine.locale)) await loadMessages(mine.locale);
  } catch {
    // The page shows the plain reason (portal off, login turned off); nothing to load.
  }
  return { me, plants };
}
