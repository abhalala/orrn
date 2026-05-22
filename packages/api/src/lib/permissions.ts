import type { CompanyRole } from "@orrn/db/schema/tenant";

/**
 * Action keys used across the app.
 *
 * Convention: "{resource}.{action}" or "{namespace}.{action}".
 *
 * Used by:
 * - Server: roleGuard(...) wrappers + can() in mutations.
 * - Client (web + native): <Can do="..."> + canSee for nav.
 *
 * Server is always authoritative; client checks are convenience for hiding UI.
 */
export const ACTIONS = [
  // Customers
  "customer.create",
  "customer.update",
  "customer.delete",
  "customer.import",

  // Dies
  "die.create",
  "die.update",
  "die.delete",
  "die.import",

  // Receipts (raw material intake)
  "receipt.create",
  "receipt.update",
  "receipt.delete",

  // Bundles (operator floor work)
  "bundle.create",
  "bundle.update",
  "bundle.delete",
  "bundle.transition",

  // Dispatches
  "dispatch.create",
  "dispatch.update",
  "dispatch.delete",
  "dispatch.reserve",
  "dispatch.complete",
  "dispatch.cancel",
  "dispatch.addBundle",

  // Packing lists (generated from completed dispatches)
  "packingList.regenerate",

  // Member / role management
  "member.invite",
  "member.updateRole",
  "member.remove",

  // Company settings
  "settings.update",

  // Platform admin (only allowed if isPlatformAdmin === true)
  "platform.waitlist.review",
  "platform.company.manage",
  "platform.impersonate",
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * Role -> set of allowed action keys.
 *
 * - owner: everything.
 * - admin: everything except billing/owner-transfer (no such actions yet).
 * - manager: full CRUD on ops data + read-only members; no settings update.
 * - operator: read everything in their company; create/edit bundles + dispatches
 *   (floor work); cannot edit customers/dies; cannot delete; no settings.
 * - viewer: read-only across all modules; no create/edit/delete.
 */
const ROLE_ACTIONS: Record<CompanyRole, ReadonlySet<Action>> = {
  owner: new Set<Action>(ACTIONS.filter((a) => !a.startsWith("platform."))),
  admin: new Set<Action>(ACTIONS.filter((a) => !a.startsWith("platform."))),
  manager: new Set<Action>([
    "customer.create",
    "customer.update",
    "customer.delete",
    "customer.import",
    "die.create",
    "die.update",
    "die.delete",
    "die.import",
    "receipt.create",
    "receipt.update",
    "receipt.delete",
    "bundle.create",
    "bundle.update",
    "bundle.delete",
    "bundle.transition",
    "dispatch.create",
    "dispatch.update",
    "dispatch.delete",
    "dispatch.reserve",
    "dispatch.complete",
    "dispatch.cancel",
    "dispatch.addBundle",
    "packingList.regenerate",
  ]),
  operator: new Set<Action>([
    "bundle.create",
    "bundle.update",
    "bundle.transition",
    "dispatch.addBundle",
  ]),
  viewer: new Set<Action>(),
};

export type MeLike = {
  company: { role: CompanyRole } | null;
  isPlatformAdmin: boolean;
};

/**
 * Check if a given me-shaped object is allowed to perform an action.
 *
 * Platform-scoped actions ("platform.*") require `me.isPlatformAdmin === true`
 * regardless of company role.
 */
export function can(me: MeLike | null | undefined, action: Action): boolean {
  if (!me) return false;

  if (action.startsWith("platform.")) {
    return me.isPlatformAdmin;
  }

  if (!me.company) return false;

  return ROLE_ACTIONS[me.company.role].has(action);
}

/**
 * Convenience: at least one of N actions is allowed. Useful for nav entries
 * that link to a section with multiple possible activities.
 */
export function canAny(me: MeLike | null | undefined, actions: readonly Action[]): boolean {
  return actions.some((a) => can(me, a));
}
