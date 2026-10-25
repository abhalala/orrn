/**
 * FP-PF-17 plant switcher: who gets the header control and what it lists. Pure, so the rules are
 * unit-tested. The control shows only when the person belongs to more than one active plant and is
 * not impersonating (the impersonation banner is the only exit then). The header is a choice, never
 * authority: the server re-checks the membership on `company.switch`.
 */
export type SwitcherMe = {
  company?: { id: string; name: string } | null;
  memberships?: readonly { companyId: string; name: string; role: string }[] | null;
  impersonation?: unknown;
} | null | undefined;

export type SwitcherPlant = { companyId: string; name: string; role: string; current: boolean };

export function switcherPlants(me: SwitcherMe): SwitcherPlant[] | null {
  if (!me?.company || me.impersonation) return null;
  const list = me.memberships ?? [];
  if (list.length <= 1) return null;
  const currentId = me.company.id;
  // Current first, then the rest in the server's order (most recently used first).
  const rows = list.map((m) => ({ companyId: m.companyId, name: m.name, role: m.role, current: m.companyId === currentId }));
  return [...rows.filter((r) => r.current), ...rows.filter((r) => !r.current)];
}
