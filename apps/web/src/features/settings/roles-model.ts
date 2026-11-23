/**
 * Pure rules of Settings > Roles (XE PLATFORM row 79). The server judges every save (`routers/roles.ts`); this file
 * only groups the switchable actions by area, says which switches are the base role's, and which the person cannot
 * switch on because they do not hold the action themselves.
 */
import type { MessageKey } from "@orrn/i18n";

export const ROLE_NAME_MAX = 40;

export type RoleAreaId =
  | "packing"
  | "dispatch"
  | "orders"
  | "foundry"
  | "press"
  | "ageing"
  | "dies"
  | "store"
  | "maintenance"
  | "quality"
  | "pricing"
  | "billing"
  | "masters"
  | "people"
  | "reports"
  | "imports";

/** The areas in screen order, each with the actions a custom role may switch there. Every `ROLE_TOGGLE_ACTIONS` entry sits in exactly one (the test checks). */
export const ROLE_AREAS: readonly { id: RoleAreaId; actions: readonly string[] }[] = [
  { id: "packing", actions: ["bundle.pack", "bundle.void", "stock.move", "stock.count"] },
  { id: "dispatch", actions: ["dispatch.scan", "dispatch.complete", "packingList.combine", "invoice.link"] },
  { id: "orders", actions: ["order.manage", "order.plan", "order.price", "order.reallocate"] },
  { id: "foundry", actions: ["cast.enter", "cast.close", "melt.enter", "melt.correct", "foundry.homog", "foundry.homogRelease", "foundry.logs", "foundry.billets", "foundry.reject", "foundry.plan"] },
  { id: "press", actions: ["press.run", "press.close", "press.queue", "qc.enter"] },
  { id: "ageing", actions: ["ageing.view", "ageing.enter", "ageing.load", "ageing.record", "ageing.release"] },
  { id: "dies", actions: ["die.reading", "die.card", "die.rerank", "die.issue", "die.maker"] },
  { id: "store", actions: ["purchase.receipt", "purchase.dcnote", "store.txn", "indent.raise", "indent.approve", "po.view", "po.manage", "store.value", "store.rate"] },
  { id: "maintenance", actions: ["maint.view", "maint.manage", "maint.workorder"] },
  { id: "quality", actions: ["complaint.open", "complaint.manage", "qa.check", "qa.hold", "qa.release", "qa.masters"] },
  { id: "pricing", actions: ["price.view", "price.manage", "quote.manage", "enquiry.manage"] },
  { id: "billing", actions: ["gst.settings", "invoice.read", "invoice.issue", "invoice.cancel", "payment.record"] },
  { id: "masters", actions: ["masters.draft", "masters.publish", "docs.manage", "approvalRule.manage", "refFormat.manage"] },
  { id: "people", actions: ["users.manage", "portal.manage", "support.request", "audit.read"] },
  { id: "reports", actions: ["reports.read", "analytics.view", "mis.view", "export.accounts", "cost.view", "cost.manage"] },
  { id: "imports", actions: ["ingest.upload", "ingest.merge", "ingest.check"] },
];

export const areaKey = (id: RoleAreaId) => `plat3.areas.${id}` as MessageKey;
/** `bundle.pack` is `plat3.actions.bundle__pack`. */
export const actionWordKey = (action: string) => `plat3.actions.${action.replace(/\./g, "__")}` as MessageKey;

/** The server's switchable actions grouped by area, in screen order; an area with none of them is left out. An action no area knows goes last in "people". */
export function groupActions(toggleActions: readonly string[]): { id: RoleAreaId; actions: string[] }[] {
  const wanted = new Set(toggleActions);
  const known = new Set(ROLE_AREAS.flatMap((a) => a.actions));
  const stray = toggleActions.filter((a) => !known.has(a));
  return ROLE_AREAS.map((area) => ({
    id: area.id,
    actions: [...area.actions.filter((a) => wanted.has(a)), ...(area.id === "people" ? stray : [])],
  })).filter((area) => area.actions.length > 0);
}

/** What the form holds: the name, the base role and the actions that are on. */
export type RoleDraft = { name: string; baseRole: string; enabled: readonly string[] };

export function draftFromBase(baseRole: string, fixed: Readonly<Record<string, readonly string[]>>): RoleDraft {
  return { name: "", baseRole, enabled: [...(fixed[baseRole] ?? [])] };
}

export function draftFromRole(role: { name: string; baseRole: string; actions: readonly string[] }): RoleDraft {
  return { name: role.name, baseRole: role.baseRole, enabled: [...role.actions] };
}

/** The server's input: `on` is what is switched on beyond the base, `off` what the base has and is switched off. */
export function changesAgainstBase(enabled: readonly string[], base: readonly string[], toggleActions: readonly string[]): { on: string[]; off: string[] } {
  const on = new Set(enabled);
  const baseSet = new Set(base);
  return {
    on: toggleActions.filter((a) => on.has(a) && !baseSet.has(a)),
    off: toggleActions.filter((a) => baseSet.has(a) && !on.has(a)),
  };
}

export function flip(enabled: readonly string[], action: string): string[] {
  return enabled.includes(action) ? enabled.filter((a) => a !== action) : [...enabled, action];
}

export type SwitchView = {
  on: boolean;
  inBase: boolean;
  changed: boolean;
  /** Cannot be switched on: the person does not hold the action. A switch that is on can always be switched off. */
  disabled: boolean;
  reason: "cannotGive" | null;
};

export function switchView(action: string, enabled: readonly string[], base: readonly string[], mine: readonly string[]): SwitchView {
  const on = enabled.includes(action);
  const inBase = base.includes(action);
  const holds = mine.includes(action);
  const disabled = !on && !holds;
  return { on, inBase, changed: on !== inBase, disabled, reason: disabled ? "cannotGive" : null };
}

/** Actions switched on that the person does not hold: the server refuses to save the role until they are switched off. */
export function lackingActions(enabled: readonly string[], mine: readonly string[]): string[] {
  return enabled.filter((a) => !mine.includes(a));
}

export type DraftError = "nameRequired" | "tooLong" | "cannotGive";

export function draftErrors(draft: RoleDraft, mine: readonly string[]): DraftError[] {
  const out: DraftError[] = [];
  const name = draft.name.trim();
  if (name.length === 0) out.push("nameRequired");
  if (name.length > ROLE_NAME_MAX) out.push("tooLong");
  if (lackingActions(draft.enabled, mine).length > 0) out.push("cannotGive");
  return out;
}

/** Fixed roles a custom role may copy: all but the owner, in the order given. */
export function copyableRoles<R extends string>(roles: readonly R[]): Exclude<R, "owner">[] {
  return roles.filter((r): r is Exclude<R, "owner"> => r !== "owner");
}

export function draftChanged(draft: RoleDraft, saved: RoleDraft): boolean {
  const a = [...draft.enabled].sort().join(",");
  const b = [...saved.enabled].sort().join(",");
  return draft.name.trim() !== saved.name.trim() || a !== b;
}

// ---------------------------------------------------------------------------
// A member's role choice: one list of the fixed roles and the plant's own roles
// ---------------------------------------------------------------------------

export type RoleChoice = { kind: "fixed"; role: string } | { kind: "custom"; id: string };

export const choiceValue = (c: RoleChoice): string => (c.kind === "fixed" ? `fixed:${c.role}` : `custom:${c.id}`);

export function parseChoice(value: string): RoleChoice | null {
  const at = value.indexOf(":");
  if (at < 0) return null;
  const id = value.slice(at + 1);
  if (!id) return null;
  if (value.startsWith("fixed:")) return { kind: "fixed", role: id };
  if (value.startsWith("custom:")) return { kind: "custom", id };
  return null;
}

/** The member's own pick: their custom role when they hold one, else the fixed role. */
export function currentChoice(role: string, customRole: { id: string } | null | undefined): RoleChoice {
  return customRole ? { kind: "custom", id: customRole.id } : { kind: "fixed", role };
}

export type SaveCall = { call: "assign"; customRoleId: string | null } | { call: "updateRole"; role: string };

/**
 * Which call a save makes; null when nothing changed. An own role is `roles.assign`. A fixed role is
 * `company.membersUpdateRole`, except going from an own role back to its base (the same fixed role the member already
 * has underneath): that is `roles.assign` with null, which only drops the own role.
 */
export function saveCall(next: RoleChoice, current: RoleChoice, memberRole: string): SaveCall | null {
  if (choiceValue(next) === choiceValue(current)) return null;
  if (next.kind === "custom") return { call: "assign", customRoleId: next.id };
  if (current.kind === "custom" && next.role === memberRole) return { call: "assign", customRoleId: null };
  return { call: "updateRole", role: next.role };
}

/** An own role the person may hand out: it holds nothing they lack (the server refuses otherwise). */
export function roleWithinMine(role: { actions: readonly string[] }, mine: readonly string[]): boolean {
  return lackingActions(role.actions, mine).length === 0;
}

/** The custom role of a member row. The member list may carry it (`customRole`); the person's own row is on `auth.me`. */
export function memberCustomRole(
  member: { userId?: string; customRole?: { id: string; name: string } | null },
  me: { user?: { id: string }; company?: { customRole?: { id: string; name: string } | null } | null } | undefined,
): { id: string; name: string } | null {
  if (member.customRole) return member.customRole;
  if (member.userId && member.userId === me?.user?.id) return me?.company?.customRole ?? null;
  return null;
}
