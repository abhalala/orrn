import type { ApprovalKind } from "@orrn/db/schema/approval";
import type { CompanyRole, PlatformStaffRole } from "@orrn/db/schema/tenant";
import type { ResolvedPrefs } from "@orrn/domain";
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
  // Wave 1 (FP). No `bundle.transfer`: moving a bundle between orders is `order.reallocate` (D6).
  "die.issue", // issue / return a die copy to a press line (die room owns it, FP-DR-16)
  "die.maker", // send a copy to the die maker, receive it back (FP-DR-15)
  "order.plan", // press plans: build, release, cancel (FP-OP-10)
  "order.price", // see and write rates on sales order lines (C23)
  "order.reallocate", // orders.reallocate: bundles between lines or to plant stock (FP-OP-08/09)
  "press.close", // close / reopen a logged press run, confirm times (FP-PR)
  "ageing.view", // ageing board and readings, read only (FP-AG)
  "packingList.combine", // one packing list over several dispatches of a customer (FP-PK-13)
  "portal.manage", // customer portal users and portal orders (Wave 3)
  "audit.read", // the company audit log
  "support.request", // ask platform support for help
  // Wave 2 (FP). FP-PR-25 change the press queue after release (Q15 default: supervisor + planner).
  "press.queue", // reorder queued / die_issued runs, pull a cut length back to planable
  // Wave 2 foundry (W2-FD-S): the melt stepper and its correction.
  "melt.enter", // save a draft melt, lock it, attach / void spectro, furnace readings
  "melt.correct", // ask to correct a locked melt (approval melt_correct) and redo it as a draft
  // Wave 3 ageing (W3-AG-C). `ageing.enter` stays as the station umbrella key; procedures use these.
  "ageing.load", // put press lines / bundles on a trolley, start a cycle, take it out, void a loading batch
  "ageing.record", // temperature readings and hardness samples
  "ageing.release", // QC verdict: release, hold, rework, discard the rest, void after take-out, ask for an override
  // Infinity Portal (plan 2026-11-10, A8): bring old files in, and merge approved imports into live tables.
  "ingest.upload", // upload files, answer questions, map columns, hold or discard an import
  "ingest.merge", // approve imports and run the merge
  // Item 16 (owner decision "Price-viewers tick, admin approves"): read only, the review of a model-read table, its
  // page image, the tick and the list of tables waiting for a check. A price column also takes order.price.
  "ingest.check",
  // XE parity lane REG. Complaints (#18, #34): raise one against a bundle; investigate, reply and close it.
  "complaint.open",
  "complaint.manage",
  // The owner's morning summary on screen and its mail settings (#81, #82): owner and plant admin.
  "mis.view",
  // XE parity lane ADM (wave 1): the document register, approver rules per kind, number formats.
  "docs.manage", // add, edit, retire plant documents and their files (#80)
  "approvalRule.manage", // who may approve each approval kind, and thresholds (#78)
  "refFormat.manage", // number formats per doc type (#77)
  // XE parity lane QA (migration 0055). `qc.enter` stays the press station's reject entry.
  "qa.check", // record a quality check (incoming, first piece, in process, clearance, dimensions, mechanical, ultrasonic), place a lot at an inspection point, record a calibration
  "qa.hold", // put a bundle on quality hold
  "qa.release", // release a bundle from quality hold, with a note
  "qa.masters", // temper master, quality plans, inspection points, alloy substitutes, instruments, quality settings
  // XE-PRICE (lane PRICE): the price master, quotations, proforma and enquiries. `order.price` stays the
  // gate for rates on order lines; these cover the master and the documents built on it.
  "price.view", // read the price master, quotations, proformas and line breakdowns
  "price.manage", // propose a master rate or customer term, ask for a line override, set pricing settings
  "quote.manage", // make, send, cancel and convert quotations; make proformas
  "enquiry.manage", // enquiries and their follow-ups
  // XE-BILL (opt-in `billing` module): tax invoices, credit notes, payments received, GST settings.
  "gst.settings", // plant GST state and HSN codes, customer GST details
  "invoice.read", // invoices, credit notes, payments and outstanding, read only
  "invoice.issue", // draft and issue invoices and credit notes, generate IRN and e-way bill
  "invoice.cancel", // ask to cancel an issued invoice (approval invoice_cancel)
  "payment.record", // record and void payments received
  // XE store (rows 69 to 73): indents, store purchase orders and the store's value.
  "indent.raise", // ask the store to buy items (a department's indent)
  "indent.approve", // approve or reject an indent
  "po.view", // read store purchase orders (rates included)
  "po.manage", // make, change, issue, close and cancel store purchase orders
  "store.value", // the store's value: average rates and the month-end stock value
  "store.rate", // set valuation rates: a GRN rate other than the order's, a pending GRN rate, an item's opening rate
  // XE parity lane MAINT (#63 to #68): plant maintenance. See the maintenance screens; set up assets, plans,
  // reading limits and the labour rate (and see the cost); raise and work work orders and take readings.
  "maint.view",
  "maint.manage",
  "maint.workorder",
  // XE parity lane FOUNDRY (rows 41-47, 50).
  "foundry.homog", // homogenizing batches: load logs, start, readings, take out
  "foundry.homogRelease", // homogenizing verdict: release, release a held batch with a reason, void
  "foundry.logs", // receive bought-in logs from a vendor, with the mill test certificate
  "foundry.billets", // cut logs into billets, issue billets to a press floor
  "foundry.reject", // log and billet reject registers
  "foundry.plan", // casting plan: accept, edit, drop, open a cast from a line
  // XE parity lane COST (module `costing`, opt-in). Rates and margins also take `order.price`.
  "cost.view", // cost per kg, capacity, forecast, dies due, the outlook page
  "cost.manage", // costing settings: stage rates, low-margin line, press hours, die fallbacks
  // XE PLATFORM (lane PLATFORM, migration 0066): custom roles; plant API tokens and webhooks (opt-in `api`).
  "role.manage", // make, edit and delete custom roles (copies of a fixed role with actions switched on or off)
  "api.manage", // plant API tokens and webhooks
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
  "platform.release.publish",
  "platform.backup.run",
  "platform.support.reply",
] as const;

/**
 * Plant actions held by the owner alone. They live apart from `PLANT_ACTIONS` because every action there
 * has a holder besides the owner (`plant-roles.test.ts`). The owner holds every tenant action, so these
 * need no row in `PLANT_ACTION_ROLES`.
 *
 * - `buddy.use`: the orrn buddy (Hermes in the floating chat, design 2026-11-18 §4.1, §13). v1 is web only,
 *   owner only; `BUDDY_ROLES` is the one list the buddy checks.
 */
export const OWNER_ONLY_ACTIONS = ["buddy.use"] as const;

/** Roles that may use the buddy (design §4.1). Opening it to other roles later is a change here (G5). */
export const BUDDY_ROLES: readonly CompanyRole[] = ["owner"];

export const ACTIONS = [...LEGACY_ACTIONS, ...PLANT_ACTIONS, ...OWNER_ONLY_ACTIONS, ...PLATFORM_ACTION_KEYS] as const;

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
  // BACKLOG 51 (SAD §8.2, §O.6): the floor operator no longer voids (legacy `bundle.transition` dropped).
  operator: [
    "bundle.create",
    "bundle.update",
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
  // BACKLOG 51 (SAD §8.2, §O.6, Q29): a supervisor voids with a reason; the floor operator does not.
  // The legacy void (bundle.transition) follows the same holders (RP4 pairs pinned in plant-roles.test.ts).
  "bundle.void": ["supervisor", "manager", "admin"],
  "stock.move": ["operator", "packer", "supervisor", "office"],
  "stock.count": ["operator", "packer", "supervisor", "office"],
  // RP4: manager/admin hold dispatch.addBundle → also dispatch.scan.
  "dispatch.scan": ["operator", "packer", "supervisor", "office", "manager", "admin"],
  "dispatch.complete": ["supervisor", "office", "manager"],
  "cast.enter": ["foundry", "supervisor"],
  // W2-FD-S: manager and up close a cast (admin = the plant admin); the supervisor keeps it (spec E4).
  "cast.close": ["supervisor", "manager", "admin"],
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
  // Wave 1 (FP contracts).
  "die.issue": ["die_room"],
  "die.maker": ["die_room"],
  "order.plan": ["office", "manager"],
  "order.price": ["office", "manager", "accountant"],
  "order.reallocate": ["supervisor", "office", "manager", "admin"],
  "press.close": ["supervisor", "manager", "admin"],
  "ageing.view": ["press", "supervisor", "office", "manager", "admin", "operator"],
  "packingList.combine": ["supervisor", "office", "manager", "admin"],
  "portal.manage": ["office", "manager", "admin"],
  "audit.read": ["admin", "manager"],
  // Wave 2 (FP-PR-25, Q15 A): the supervisor and the planner (order.plan holders).
  "press.queue": ["supervisor", "office", "manager"],
  // W2-FD-S: the foundry floor and the supervisor run the melt stepper; corrections go to an approver.
  "melt.enter": ["foundry", "supervisor"],
  "melt.correct": ["foundry", "supervisor"],
  // Wave 3 ageing (W3-AG-C): the station (press role, the floor operator) loads and records; the QC
  // verdict is a supervisor's or manager's. Approving an override is APPROVER_ROLES.ageing_override.
  "ageing.load": ["press", "supervisor", "operator"],
  "ageing.record": ["press", "supervisor", "operator"],
  "ageing.release": ["supervisor", "manager"],
  // Owner decision 2026-11-10: owner and admin may upload and merge; the same person may do both.
  "ingest.upload": ["admin"],
  "ingest.merge": ["admin"],
  // Item 16: the people who see prices tick a model-read table; the admin approves it.
  "ingest.check": ["admin", "office", "manager", "accountant"],
  // XE parity lane REG. Anyone who handles bundles for the customer may raise a complaint; the office
  // and the supervisors investigate, reply and close. The morning summary is the owner's and the admin's.
  "complaint.open": ["office", "supervisor", "manager", "admin", "packer"],
  "complaint.manage": ["office", "supervisor", "manager", "admin"],
  "mis.view": ["admin"],
  // XE ADM: documents are kept by the office and managers; approver rules and number formats are the
  // plant admin's (as settings are).
  "docs.manage": ["admin", "manager", "office"],
  "approvalRule.manage": ["admin"],
  "refFormat.manage": ["admin"],
  // XE parity lane QA: the floor people who already judge quality record checks (press first piece, the
  // foundry's incoming lots, the store's bought-in material); a supervisor or manager holds and releases.
  "qa.check": ["press", "supervisor", "manager", "foundry", "storekeeper"],
  "qa.hold": ["supervisor", "manager"],
  "qa.release": ["supervisor", "manager"],
  "qa.masters": ["manager", "admin"],
  // XE-PRICE: the people who see order rates read the master; the office desk and the manager change it.
  "price.view": ["admin", "office", "manager", "accountant"],
  "price.manage": ["admin", "office", "manager"],
  "quote.manage": ["office", "manager"],
  "enquiry.manage": ["office", "manager"],
  // XE-BILL: the billing desk (office), the accountant and the manager. GST settings (incl. the e-invoice start
  // date) are the admin's and theirs too: the billing desk keeps them up to date (review N2: comment corrected).
  "gst.settings": ["admin", "manager", "accountant", "office"],
  "invoice.read": ["office", "manager", "accountant", "admin"],
  "invoice.issue": ["office", "manager", "accountant"],
  "invoice.cancel": ["office", "manager", "accountant"],
  "payment.record": ["office", "accountant", "manager"],
  // XE store: any department head may ask; a manager decides; the office buys; the storekeeper sees
  // the orders it receives against; money reports go to the office, accounts and management.
  "indent.raise": ["storekeeper", "supervisor", "foundry", "press", "die_room", "office", "manager", "admin"],
  "indent.approve": ["manager", "admin"],
  "po.view": ["storekeeper", "office", "manager", "admin", "accountant"],
  "po.manage": ["office", "manager", "admin"],
  "store.value": ["office", "manager", "admin", "accountant"],
  // The rate is settled by the bill in the office, not at the gate: the storekeeper does not set it.
  "store.rate": ["office", "manager", "admin", "accountant"],
  // XE parity lane MAINT. Everyone who works near the machines (and the storekeeper who issues spares) sees
  // maintenance; the supervisor and up set it up; the floor raises a breakdown and works the work order.
  "maint.view": ["admin", "manager", "supervisor", "office", "storekeeper", "operator", "press", "foundry"],
  "maint.manage": ["admin", "manager", "supervisor"],
  "maint.workorder": ["admin", "manager", "supervisor", "operator", "press", "foundry"],
  // XE FOUNDRY: the foundry floor and the supervisor run batches, cuts, issues and rejects; the verdict is a
  // supervisor's or manager's; bought-in logs come in through the store; the casting plan is the planner's.
  "foundry.homog": ["foundry", "supervisor"],
  "foundry.homogRelease": ["supervisor", "manager"],
  "foundry.logs": ["foundry", "supervisor", "storekeeper"],
  "foundry.billets": ["foundry", "supervisor"],
  "foundry.reject": ["foundry", "supervisor"],
  "foundry.plan": ["supervisor", "office", "manager"],
  // XE parity lane COST: the people who run the plant's numbers read cost; the accountant reads it too.
  // Margins (rate minus cost) also need `order.price`, so admin sees cost but never a margin.
  "cost.view": ["admin", "manager", "accountant"],
  "cost.manage": ["admin", "manager"],
  // XE PLATFORM: the plant admin, as with people and settings (lane brief "Actions and grants").
  "role.manage": ["admin"],
  "api.manage": ["admin"],
  "support.request": [
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
  ],
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
 * XE PLATFORM row 79: custom roles. A custom role is a copy of one fixed role (its BASE) with plant actions
 * switched on (`added`) or off (`removed`). The base stays the member's `membership.role`, so everything that
 * keys on the role (approver rules, the Today layout, stations, who may hand out which role, owner checks)
 * reads the base. Every ACTION check reads the member's effective set, which `effectiveActions` alone computes:
 * the server puts it on the request context (`ctx.actions`, `lib/tenantContext.ts`) and `auth.me` sends it to
 * the client as `company.actions`.
 *
 * With no custom role the effective set IS the fixed role's set (`test/custom-roles-matrix.test.ts` pins every
 * action x role against the matrix as it stood before custom roles existed).
 */
export type CustomRoleGrant = {
  baseRole: CompanyRole;
  added: readonly string[];
  removed: readonly string[];
};

/**
 * Never granted by a custom role: platform staff actions, the owner's own actions, and the two that manage
 * grants themselves (a role that could edit roles or mint API tokens could widen itself).
 */
export const NEVER_GRANTABLE_ACTIONS: readonly Action[] = [...OWNER_ONLY_ACTIONS, "role.manage", "api.manage"];

/**
 * Acts the server checks by the OWNER role, not by an action (`routers/company.ts`). No custom role reaches
 * them, because the base of a custom role is never `owner` and these read the base: changing secure sign-in
 * for the plant, making, demoting or removing an owner (ownership transfer), and the buddy. Deleting the
 * company and changing its plan are platform acts (Godseye), never a tenant action.
 */
export const OWNER_ONLY_ACTS = ["secure_sign_in", "owner_roles", "owner_remove", "buddy", "company_delete", "plan_change"] as const;

/** The actions a custom role may switch on or off: every plant action (and `dispatch.complete`) not in the list above. */
export const ROLE_TOGGLE_ACTIONS: readonly Action[] = ([...PLANT_ACTIONS, "dispatch.complete"] as Action[]).filter(
  (a) => !NEVER_GRANTABLE_ACTIONS.includes(a),
);
const ROLE_TOGGLE_SET: ReadonlySet<string> = new Set(ROLE_TOGGLE_ACTIONS);

/** A fixed role a custom role may copy. Never the owner. */
export function canBeCustomBase(role: CompanyRole): boolean {
  return role !== "owner";
}

/** The fixed role's own action set (no custom role). */
export function fixedRoleActions(role: CompanyRole): ReadonlySet<Action> {
  return ROLE_ACTIONS[role];
}

/**
 * THE one function for a member's effective actions: the base role's set, then the custom role's changes.
 * - Only `ROLE_TOGGLE_ACTIONS` move; anything else in `added`/`removed` is ignored.
 * - Legacy keys follow their plant key (`LEGACY_VIA_PLANT`): switching a plant key off drops every legacy key
 *   the base held through it when no other source is left; switching one on adds them.
 * - A custom role whose base is not `role` (a broken invariant) only ever removes: fail closed.
 * - The owner never has a custom role; an owner's set is returned unchanged.
 */
export function effectiveActions(role: CompanyRole, custom?: CustomRoleGrant | null): ReadonlySet<Action> {
  const base = ROLE_ACTIONS[role];
  if (!custom || role === "owner") return base;
  const mayAdd = custom.baseRole === role;
  const added = mayAdd ? custom.added.filter((a) => ROLE_TOGGLE_SET.has(a)) : [];
  const removed = custom.removed.filter((a) => ROLE_TOGGLE_SET.has(a) && !added.includes(a));
  if (added.length === 0 && removed.length === 0) return base;
  const set = new Set<Action>(base);
  for (const a of removed) set.delete(a as Action);
  for (const a of added) set.add(a as Action);
  for (const [legacy, via] of Object.entries(LEGACY_VIA_PLANT) as [Action, (typeof LEGACY_VIA_PLANT)[LegacyAction]][]) {
    if (via === "all" || via.length === 0) continue;
    if (via.some((p) => added.includes(p))) {
      set.add(legacy);
    } else if (set.has(legacy) && via.some((p) => removed.includes(p)) && !via.some((p) => set.has(p))) {
      set.delete(legacy);
    }
  }
  return set;
}

/**
 * The permission half of a server context: the base role and the effective set. Every server-side action check
 * goes through `ctxCan` / `ctxCanAny` / `meOfCtx` (guard: `test/custom-roles-guard.test.ts`). `actions`
 * undefined means a context built without the tenant resolver (unit tests): the fixed role's set.
 */
export type PermissionCtx = { role: CompanyRole | null | undefined; actions?: ReadonlySet<Action> | null };

export function ctxActions(ctx: PermissionCtx): ReadonlySet<Action> {
  if (!ctx.role) return new Set();
  return ctx.actions ?? ROLE_ACTIONS[ctx.role];
}

export function ctxCan(ctx: PermissionCtx, action: Action): boolean {
  if (action.startsWith("platform.")) return false;
  return ctxActions(ctx).has(action);
}

export function ctxCanAny(ctx: PermissionCtx, actions: readonly Action[]): boolean {
  return actions.some((a) => ctxCan(ctx, a));
}

/** A `can()`-shaped object for a server context (keeps the effective set). */
export function meOfCtx(ctx: PermissionCtx): MeLike {
  return ctx.role
    ? { company: { role: ctx.role, actions: ctxActions(ctx) }, isPlatformAdmin: false, platformRole: null }
    : { company: null, isPlatformAdmin: false, platformRole: null };
}

/** Effective actions as a sorted list, for `auth.me` and audit rows. */
export function actionList(set: ReadonlySet<Action>): Action[] {
  return [...set].sort();
}

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
  die_owner_override: ["owner", "admin", "manager"],
  order_reallocate: ["owner", "admin", "manager"],
  press_time: ["owner", "supervisor", "manager"],
  press_reopen: ["owner", "admin", "manager"],
  ageing_override: ["owner", "admin", "manager"],
  press_late_entry: ["owner", "supervisor", "manager"],
  // W2-FD-S: correcting a locked melt (reverse it, enter it again as a draft). Never the requester.
  melt_correct: ["owner", "admin", "manager"],
  // Q36/Q40: a bundle more than 0.1 kg/12ft off its order line at dispatch. Never the requester.
  dispatch_off_band: ["owner", "admin", "manager"],
  // arch 52: a dispatch completed later at the time the truck left (line down). Never the requester.
  dispatch_late_entry: ["owner", "admin", "manager"],
  // XE-PRICE: a master rate change or a line override below the computed rate. Never the requester.
  price_change: ["owner", "admin", "manager"],
  // XE-BILL: cancelling an issued tax invoice (its number stays used). Never the requester.
  invoice_cancel: ["owner", "admin", "manager"],
};

/** Who may read scrap purchase figures (mirror of `purchaseReader` in routers/vendor.ts). */
export const PURCHASE_READ_ACTIONS: readonly Action[] = ["purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish"];

/**
 * Roles a plant's approver rule may name (XE ADM #78, review B1). Floor roles and the read-only viewer
 * never decide a request; the owner is always an approver anyway.
 */
export const APPROVAL_CAPABLE_ROLES: readonly CompanyRole[] = ["owner", "admin", "manager", "supervisor", "foundry", "accountant", "office", "storekeeper", "die_room"];

/** The roles a rule for this kind may name: approval-capable, and able to read what the kind decides. */
export function approvalRuleRoles(kind: string): readonly CompanyRole[] {
  if (kind === "dc_note") {
    return APPROVAL_CAPABLE_ROLES.filter((role) => PURCHASE_READ_ACTIONS.some((a) => ROLE_ACTIONS[role].has(a)));
  }
  return APPROVAL_CAPABLE_ROLES;
}

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
    "platform.release.publish",
    "platform.backup.run",
    "platform.support.reply",
    "platform.waitlist.signInLink",
  ]),
  support: new Set<Action>([
    "platform.waitlist.review",
    "platform.company.manage",
    "platform.staff.list",
    "platform.support.reply",
  ]),
};

export type MeLike = {
  /**
   * `actions`: the member's effective action set (custom roles, XE PLATFORM). When present, `can()` reads it and
   * not the role's fixed set. The server always sends it (`auth.me` `company.actions`).
   */
  company: { role: CompanyRole; actions?: ReadonlySet<Action> | readonly Action[] | readonly string[] } | null;
  isPlatformAdmin: boolean;
  platformRole?: PlatformStaffRole | null;
};

export type MemberNavOrder = {
  order: string[];
  /** Undefined keeps the default divider. Null puts every item above it. */
  moreFrom?: string | null;
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
    /** The account has at least one passkey (plan 2026-11-18). */
    hasPasskey?: boolean;
    /** A Google account is linked (plan 2026-11-18). */
    hasGoogle?: boolean;
  };
  company: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string | null;
    modules?: string[];
    role: CompanyRole;
    /** The member's effective actions (custom roles, XE PLATFORM); absent on old payloads. */
    actions?: readonly string[];
    /** The custom role the member holds, if any (its base is `role`). */
    customRole?: { id: string; name: string } | null;
    settings?: { lengthUnit?: LengthUnit; [key: string]: unknown };
    /** Resolved units and formats for this plant's screens (`screenPrefs`). Absent on old payloads. */
    units?: ResolvedPrefs;
    navOrder?: MemberNavOrder | null;
    /** The plant requires a passkey, Google or the authenticator app of every member (plan 2026-11-18, Task 9). */
    requireStrongSignIn?: boolean;
    /** This plant's onboarding is still open for the person (`membership.onboarded_at` is null). Absent on old payloads. */
    setupPending?: boolean;
  } | null;
  /**
   * Every active company the user belongs to (spec P10); `company` is the active one. `setupPending`:
   * that plant's onboarding is still open for the person (the plant picker's "Setup pending").
   */
  memberships?: { companyId: string; name: string; role: CompanyRole; setupPending?: boolean }[];
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
 * A strong method: the authenticator app, a passkey or a linked Google account (plan 2026-11-18). A
 * plant that requires secure sign-in asks for one; the server refuses to remove the last one while such
 * a plant holds the person (`COMPANY_REQUIRES_STRONG_METHOD`). The one rule for web and native over `Me`.
 */
export function hasStrongMethod(me: Pick<Me, "user">): boolean {
  return me.user.twoFactorEnabled === true || me.user.hasPasskey === true || me.user.hasGoogle === true;
}

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

  const actions = me.company.actions;
  if (actions) return actionSetOf(actions).has(action);
  return ROLE_ACTIONS[me.company.role].has(action);
}

/** A list from `auth.me` becomes a Set once per payload object. */
const ACTION_SET_CACHE = new WeakMap<object, ReadonlySet<string>>();
function actionSetOf(actions: ReadonlySet<Action> | readonly string[]): ReadonlySet<string> {
  if (actions instanceof Set) return actions as ReadonlySet<string>;
  const list = actions as readonly string[];
  let set = ACTION_SET_CACHE.get(list);
  if (!set) {
    set = new Set(list);
    ACTION_SET_CACHE.set(list, set);
  }
  return set;
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

/**
 * A fixed role's own rights, for checks about ANOTHER member picked in a form (who may be named operator or
 * supervisor on a press run). Never for the caller: the caller's checks go through `ctxCan`. Every use is listed
 * in `test/custom-roles-guard.test.ts`.
 */
export function fixedRoleCan(role: CompanyRole, action: Action): boolean {
  return ROLE_ACTIONS[role].has(action);
}
