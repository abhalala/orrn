import type { Me } from "@orrn/server/lib/permissions";

import { homeFor, needsPlantChoice } from "@/shared/lib/home";
import { safeNext } from "@/shared/lib/safe-next";

/**
 * "Choose a plant" after sign-in (plan 2026-11-18, Task 9; owner amendment item 4). Pure, so the route's
 * `validateSearch` / `beforeLoad` can use it without pulling the page in: no tRPC, React or zod.
 *
 * A person with more than one active plant lands here after every sign-in (`homeFor` sends them while
 * `needsPlantChoice` holds). Picking calls `company.switch`, marks `orrn.plantChosen` for this tab and
 * goes on to that plant's welcome steps when they are open, else Today (or the `next` they signed in for).
 */
export { needsPlantChoice };
export { clearPlantChosen, markPlantChosen, PLANT_CHOSEN_KEY, readPlantChosen } from "@/shared/lib/plant-chosen";

export type PickerPlant = { companyId: string; name: string; role: string; setupPending: boolean };

/** The plants to list, in the server's order (most recently used first), each with "Setup pending". */
export function pickerPlants(me: Me): PickerPlant[] {
  return (me.memberships ?? []).map((m) => ({
    companyId: m.companyId,
    name: m.name,
    role: m.role,
    setupPending: m.setupPending === true,
  }));
}

/**
 * Where to go once the picked plant's `auth.me` is in hand: its welcome steps when its setup is open
 * or it requires a strong method the person lacks, else Today or a same-origin `next`. Never back here.
 */
export function destinationAfterPick(fresh: Me, next?: string): string {
  const home = homeFor(fresh, true);
  return home === "/today" ? safeNext(next, home) : home;
}

/** `/choose-plant?next=`: only a same-origin path is kept (a plain function: no zod in route files). */
export function choosePlantSearch(search: Record<string, unknown>): { next?: string } {
  const next = typeof search.next === "string" ? safeNext(search.next, "") : "";
  return next ? { next } : {};
}
