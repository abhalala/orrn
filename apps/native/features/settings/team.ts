import type { Action } from "@orrn/server/lib/permissions";

/** Roles from most to least access, the order the team list reads in. */
const ROLE_ORDER = [
  "owner",
  "admin",
  "manager",
  "office",
  "accountant",
  "supervisor",
  "packer",
  "foundry",
  "press",
  "storekeeper",
  "die_room",
  "operator",
  "viewer",
] as const;

export type Member = { id: string; role: string; user: { id: string; name: string; email: string } };

function rank(role: string): number {
  const i = (ROLE_ORDER as readonly string[]).indexOf(role);
  return i === -1 ? ROLE_ORDER.length : i;
}

/** Team list order: by role, then by name. */
export function sortMembers<M extends Pick<Member, "role" | "user">>(members: readonly M[]): M[] {
  return [...members].sort(
    (a, b) => rank(a.role) - rank(b.role) || a.user.name.localeCompare(b.user.name, "en", { sensitivity: "base" }),
  );
}

/** Same actions as web's Settings nav item (ruling R24): who may see the team. */
export const TEAM_ACTIONS: readonly Action[] = ["settings.update", "member.invite", "member.updateRole", "member.remove", "users.manage"];
