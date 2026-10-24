import type { ApprovalKind } from "@orrn/db/schema/approval";
import type { CompanyRole, PlatformStaffRole } from "@orrn/db/schema/tenant";
import type { LengthUnit } from "./length";

export type { ApprovalKind, CompanyRole, PlatformStaffRole };

/**
 * Action keys used across the app.
 *
 * Convention: "{resource}.{action}" or "{namespace}.{action}".
 *
 * Used by:
 * - Server: actionProcedure(action) on every mutation (can() underneath).
 * - Client (web + native): <Can do="..."> + canSee for nav.
 *
 * Server is always authoritative; client checks are convenience for hiding UI.
 */
export const LEGACY_ACTIONS = [
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

  // Receipts (bundling sessions in the UI)
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

  // Edge node lifecycle
  "edge.manage",

  // Spool / printing
  "spool.list_printers",
  "spool.manage_printers",
  "spool.manage_templates",
  "spool.push_templates",
  "spool.create_jobs",
  "spool.manage_jobs",
  "spool.view_queue",
] as const;

/**
 * Plant actions (spec P9, digest §4.2). One key per matrix row; "approve" cells
 * are not actions but approver roles for an `approval` kind (APPROVER_ROLES).
 */
export const PLANT_ACTIONS = [
  "bundle.pack", // pack a bundle, print its label (≡ bundle.create)
  "bundle.void", // void a bundle, reason required
  "stock.move",
  "stock.count",
  "dispatch.scan", // scan bundles onto a packing list
  "cast.enter", // cast entry, spectro attach
  "cast.close", // cast close-out (explain the tail)
  "press.run", // press run, die in/out, downtime reason
  "die.reading", // die weight reading
  "die.card", // nitriding log, die card
  "die.rerank", // propose a die tier change
  "purchase.receipt", // purchase receipt, party vs FC kanta
  "purchase.dcnote", // debit/credit note on a scrap lot
  "store.txn", // store issue (MRS), receipt (GRN)
  "order.manage", // sales order and lines
  "invoice.link", // tax invoice number on a dispatch (Tally is the invoice of record, P12)
  "masters.draft", // propose customers, vendors, sections, prices
  "masters.publish", // publish masters
  "users.manage", // users, PINs, phones, printers
  "export.accounts", // GST returns JSON, Tally export
  "reports.read",
  "qc.enter", // QC station (P9: press + supervisor)
  "ageing.enter", // ageing station (P9: press + supervisor)
  "analytics.view", // charts and customer analytics (analytics addendum A1)
] as const;

export const PLATFORM_ACTION_KEYS = [
  // Platform staff (orrn.app) — checked against platformRole, not tenant role
  "platform.waitlist.review",
  "platform.company.manage",
  "platform.impersonate",
  "platform.staff.list",
  "platform.staff.create",
  "platform.staff.updateRole",
  "platform.staff.remove",
  "platform.spool.manage",
  "platform.edge.manage",
  // Issue (and see) a one-time sign-in link for an approved owner. Not support:
  // a link is a full session without a password, so it sits with the roles that
  // already hold platform.impersonate.
  "platform.waitlist.signInLink",
] as const;

export const ACTIONS = [...LEGACY_ACTIONS, ...PLANT_ACTIONS, ...PLATFORM_ACTION_KEYS] as const;

export type Action = (typeof ACTIONS)[number];
type LegacyAction = (typeof LEGACY_ACTIONS)[number];
type PlantAction = (typeof PLANT_ACTIONS)[number];

const PLATFORM_ACTIONS: Action[] = [...PLATFORM_ACTION_KEYS];
const TENANT_ACTIONS: Action[] = ACTIONS.filter((a) => !a.startsWith("platform."));

/**
 * The pre-plant matrix for the five original roles, kept exactly as it was so
 * existing tenants see no change on existing actions:
 *
 * - owner / admin: every legacy action.
 * - manager: full CRUD on ops data, printers, templates and print jobs; no members or settings.
 * - operator: create/edit bundles, transition bundles, add bundles to dispatches, print.
 * - viewer: read-only.
 */
const LEGACY_ROLE_ACTIONS = {
  owner: [...LEGACY_ACTIONS],
  admin: [...LEGACY_ACTIONS],
  manager: LEGACY_ACTIONS.filter(
    (a) => !["member.invite", "member.updateRole", "member.remove", "settings.update"].includes(a),
  ),
  operator: [
    "bundle.create",
    "bundle.update",
    "bundle.transition",
    "dispatch.addBundle",
    "spool.list_printers",
    "spool.create_jobs",
    "spool.view_queue",
  ],
  viewer: ["spool.list_printers", "spool.view_queue"],
} satisfies Partial<Record<CompanyRole, readonly LegacyAction[]>>;

/**
 * Who holds each plant action — digest §4.2 verbatim (owner holds everything
 * and is not listed). Additions from spec P9: QC/ageing → press + supervisor;
 * RP3: bundle.pack also for admin/manager/operator (they hold bundle.create);
 * RP4: every legacy holder of a legacy action also holds its plant key
 * (dispatch.scan ⇐ dispatch.addBundle, bundle.void ⇐ bundle.transition), so a
 * guard can move to the plant key with no silent loss (pinned in plant-roles.test.ts);
 * reports read for office roles and viewer. `dispatch.complete` already exists
 * as a legacy action; the plant roles listed here are added to it.
 */
const PLANT_ACTION_ROLES: Record<PlantAction | "dispatch.complete", readonly CompanyRole[]> = {
  // Digest: packer + supervisor. Ruling RP3: also every legacy role that packs via
  // bundle.create (admin, manager, operator), so bundle.pack ≡ bundle.create for everyone.
  "bundle.pack": ["packer", "supervisor", "manager", "admin", "operator"],
  // RP4: operator holds bundle.transition (legacy void) → also bundle.void.
  "bundle.void": ["supervisor", "manager", "admin", "operator"],
  "stock.move": ["operator", "packer", "supervisor", "office"],
  "stock.count": ["operator", "packer", "supervisor", "office"],
  // RP4: manager/admin hold dispatch.addBundle → also dispatch.scan.
  "dispatch.scan": ["operator", "packer", "supervisor", "office", "manager", "admin"],
  "dispatch.complete": ["supervisor", "office", "manager"],
  "cast.enter": ["foundry", "supervisor"],
  "cast.close": ["supervisor", "manager"],
  "press.run": ["press", "supervisor"],
  "die.reading": ["press", "supervisor", "die_room"],
  "die.card": ["die_room"],
  "die.rerank": ["die_room"],
  "purchase.receipt": ["operator", "storekeeper", "office"],
  "purchase.dcnote": ["office"],
  "store.txn": ["storekeeper"],
  "order.manage": ["office", "manager"],
  "invoice.link": ["office", "manager"],
  "masters.draft": ["office", "manager", "admin"],
  "masters.publish": ["manager", "admin"],
  "users.manage": ["admin"],
  "export.accounts": ["office", "accountant"],
  "reports.read": ["supervisor", "office", "manager", "admin", "accountant", "viewer"],
  "qc.enter": ["press", "supervisor"],
  "ageing.enter": ["press", "supervisor"],
  // Analytics addendum A1: owner/manager get charts, not the floor; office (order desk) and the
  // accountant need customer numbers. Floor roles and viewer do not hold it.
  "analytics.view": ["admin", "manager", "office", "accountant"],
};

/**
 * Legacy action → the plant action(s) that grant it to the NEW roles (the five
 * original roles keep their frozen legacy sets). "all" = every role. Resolved
 * after PLANT_ACTION_ROLES, so `dispatch.complete` holders count.
 * e.g. `bundle.create` ≡ `bundle.pack`, so a packer can use today's pack flow.
 */
const LEGACY_VIA_PLANT: Record<LegacyAction, readonly (PlantAction | "dispatch.complete")[] | "all"> = {
  "customer.create": ["masters.publish"],
  "customer.update": ["masters.publish"],
  "customer.delete": ["masters.publish"],
  "customer.import": ["masters.publish"],
  "die.create": ["masters.publish"],
  "die.update": ["masters.publish"],
  "die.delete": ["masters.publish"],
  "die.import": ["masters.publish"],
  "receipt.create": ["bundle.pack"],
  "receipt.update": ["bundle.pack"],
  "receipt.delete": ["bundle.void"],
  "bundle.create": ["bundle.pack"],
  "bundle.update": ["bundle.pack"],
  "bundle.delete": ["bundle.void"],
  "bundle.transition": ["bundle.void"],
  "bundle.import": ["masters.publish"],
  "dispatch.create": ["dispatch.scan"],
  "dispatch.update": ["dispatch.scan"],
  "dispatch.addBundle": ["dispatch.scan"],
  "dispatch.reserve": ["dispatch.scan"],
  "dispatch.complete": [], // granted directly via PLANT_ACTION_ROLES
  "dispatch.cancel": ["dispatch.complete"],
  "dispatch.delete": ["dispatch.complete"],
  "packingList.regenerate": ["dispatch.complete"],
  "member.invite": ["users.manage"],
  "member.updateRole": ["users.manage"],
  "member.remove": ["users.manage"],
  "settings.update": ["users.manage"],
  "edge.manage": ["users.manage"],
  "spool.list_printers": "all",
  "spool.view_queue": "all",
  "spool.create_jobs": ["bundle.pack", "dispatch.scan"],
  "spool.manage_jobs": ["bundle.pack", "dispatch.complete"],
  "spool.manage_printers": ["users.manage"],
  "spool.manage_templates": ["users.manage"],
  "spool.push_templates": ["users.manage"],
};

function buildRoleActions(role: CompanyRole): ReadonlySet<Action> {
  if (role === "owner") return new Set(TENANT_ACTIONS);
  const legacy: readonly Action[] | undefined = (LEGACY_ROLE_ACTIONS as Partial<Record<CompanyRole, readonly Action[]>>)[
    role
  ];
  const set = new Set<Action>(legacy ?? []);
  for (const [action, roles] of Object.entries(PLANT_ACTION_ROLES)) {
    if (roles.includes(role)) set.add(action as Action);
  }
  if (!legacy) {
    for (const [action, via] of Object.entries(LEGACY_VIA_PLANT)) {
      if (via === "all" || via.some((p) => set.has(p))) set.add(action as Action);
    }
  }
  return set;
}

/** Role -> set of allowed action keys (keyed object so a new role fails type-checking here). */
const ROLE_ACTIONS: Record<CompanyRole, ReadonlySet<Action>> = {
  owner: buildRoleActions("owner"),
  admin: buildRoleActions("admin"),
  manager: buildRoleActions("manager"),
  office: buildRoleActions("office"),
  accountant: buildRoleActions("accountant"),
  supervisor: buildRoleActions("supervisor"),
  packer: buildRoleActions("packer"),
  foundry: buildRoleActions("foundry"),
  press: buildRoleActions("press"),
  storekeeper: buildRoleActions("storekeeper"),
  die_room: buildRoleActions("die_room"),
  operator: buildRoleActions("operator"),
  viewer: buildRoleActions("viewer"),
};

/**
 * Approver roles per approval kind (digest §4.2 "approve" cells; manager, plant
 * admin and owner approve everything that needs a second person). The
 * requester can never approve their own request.
 */
export const APPROVER_ROLES: Record<ApprovalKind, readonly CompanyRole[]> = {
  dc_note: ["owner", "admin", "manager"],
  cast_close: ["owner", "admin", "manager", "foundry"],
  die_rerank: ["owner", "admin", "manager"],
  dispatch_overdraw: ["owner", "admin", "manager"],
  phantom_void: ["owner", "admin", "manager"],
};

export function canApprove(role: CompanyRole | null | undefined, kind: ApprovalKind): boolean {
  return Boolean(role && APPROVER_ROLES[kind].includes(role));
}

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
    "platform.spool.manage",
    "platform.edge.manage",
    "platform.waitlist.signInLink",
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
    /** A credential (email + password) login exists. False for a magic-link account until it sets one. */
    hasPassword?: boolean;
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
  /** Every active company the user belongs to (spec P10); `company` is the active one. */
  memberships?: { companyId: string; name: string; role: CompanyRole }[];
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
