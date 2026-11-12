import type { Me } from "@orrn/server/lib/permissions";

import { showsDieWorkLists, showsFoundryMasters } from "./more-rows";

export type MoreRoute = "furnaces" | "alloys" | "nitriding" | "makers";
export type MoreAccess = "allowed" | "not_allowed";

export function moreRouteAccess(me: Pick<Me, "company"> | null | undefined, route: MoreRoute): MoreAccess {
  const allowed = route === "furnaces" || route === "alloys" ? showsFoundryMasters(me) : showsDieWorkLists(me);
  return allowed ? "allowed" : "not_allowed";
}
