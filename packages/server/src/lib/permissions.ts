import type { CompanyRole, PlatformStaffRole } from "@orrn/db/schema/tenant";
import type { LengthUnit } from "./length";

export type { PlatformStaffRole };

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
  "bundle.import",

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

  // Platform staff (orrn.app) — checked against platformRole, not tenant role
  "platform.waitlist.review",
  "platform.company.manage",
  "platform.impersonate",
  "platform.staff.list",
  "platform.staff.create",
  "platform.staff.updateRole",
  "platform.staff.remove",
] as const;

export type Action = (typeof ACTIONS)[number];

const PLATFORM_ACTIONS = ACTIONS.filter((a) => a.startsWith("platform.")) as Action[];

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
    "bundle.import",
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

/** ORRN staff console (orrn.app) permissions by internal staff role. */
const PLATFORM_ROLE_ACTIONS: Record<PlatformStaffRole, ReadonlySet<Action>> = {
  super_admin: new Set<Action>(PLATFORM_ACTIONS),
  admin: new Set<Action>([
    "platform.waitlist.review",
    "platform.company.manage",
    "platform.impersonate",
    "platform.staff.list",
    "platform.staff.create",
    "platform.staff.updateRole",
  ]),
  support: new Set<Action>(["platform.waitlist.review", "platform.company.manage", "platform.staff.list"]),
};

export type MeLike = {
  company: { role: CompanyRole } | null;
  isPlatformAdmin: boolean;
  platformRole?: PlatformStaffRole | null;
};

export type Me = {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    onboardingCompleted?: boolean;
    twoFactorEnabled?: boolean;
    mustChangePassword?: boolean;
  };
  company: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string | null;
    modules?: string[];
    role: CompanyRole;
    settings?: { lengthUnit?: LengthUnit; [key: string]: unknown };
  } | null;
  isPlatformAdmin: boolean;
  platformRole?: PlatformStaffRole | null;
  impersonation?: {
    actorUserId: string;
    companyId: string;
    grantId: string;
    expiresAt: string;
  } | null;
};

/**
 * Check if a given me-shaped object is allowed to perform an action.
 *
 * Platform-scoped actions require a platform staff role with the action in its set.
 */
export function can(me: MeLike | Me | null | undefined, action: Action): boolean {
  if (!me) return false;

  if (action.startsWith("platform.")) {
    if (!me.isPlatformAdmin || !me.platformRole) return false;
    return PLATFORM_ROLE_ACTIONS[me.platformRole].has(action);
  }

  if (!me.company) return false;

  return ROLE_ACTIONS[me.company.role].has(action);
}

/**
 * Convenience: at least one of N actions is allowed. Useful for nav entries
 * that link to a section with multiple possible activities.
 */
export function canAny(
  me: MeLike | Me | null | undefined,
  actions: readonly Action[],
): boolean {
  return actions.some((a) => can(me, a));
}

/** Roles a staff member may assign when creating/updating others (never above own role). */
export function assignablePlatformRoles(actor: PlatformStaffRole): PlatformStaffRole[] {
  switch (actor) {
    case "super_admin":
      return ["super_admin", "admin", "support"];
    case "admin":
      return ["admin", "support"];
    default:
      return [];
  }
}

export function canAssignPlatformRole(
  actor: PlatformStaffRole,
  target: PlatformStaffRole,
): boolean {
  return assignablePlatformRoles(actor).includes(target);
}
