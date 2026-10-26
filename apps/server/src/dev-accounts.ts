/** Fixed local-dev logins. Pure constants so scripts can import them without the Workers runtime. */
export const DEV_ACCOUNTS = {
  owner: { email: "owner@orrn.local", name: "Local Owner" },
  operator: { email: "operator@orrn.local", name: "Local Operator" },
  viewer: { email: "viewer@orrn.local", name: "Local Viewer" },
  /** Plant admin: everything but the owner-only company actions. */
  admin: { email: "admin@orrn.local", name: "Local Admin" },
  /** Plant manager: approvals (reallocate, tier, late entry), order planning, close. */
  manager: { email: "manager@orrn.local", name: "Local Manager" },
  /** Packing bay: packs, scans and builds dispatches (bundle.pack, scan, dispatch). */
  packer: { email: "packer@orrn.local", name: "Local Packer" },
  /** Store: GRN and MRS for chemicals, spares and consumables. */
  storekeeper: { email: "storekeeper@orrn.local", name: "Local Storekeeper" },
  /** Foundry: casts and melts (cast.enter). */
  foundry: { email: "foundry@orrn.local", name: "Local Foundry" },
  /** Accounts: prices on orders, purchase book. */
  accountant: { email: "accountant@orrn.local", name: "Local Accountant" },
  /** Plant office: raises D/C notes on scrap lots (purchase.dcnote). */
  office: { email: "office@orrn.local", name: "Local Office" },
  /** Press supervisor (press.run, press.close, press.queue): logs runs, decides nothing else (FP-PR). */
  supervisor: { email: "supervisor@orrn.local", name: "Local Supervisor" },
  /** Press man (press.run only): starts, stops and counts a run; cannot log it. */
  press: { email: "press@orrn.local", name: "Local Press" },
  /** Die room: readings, die card, tier proposals, issue and maker (die.* actions). */
  dieroom: { email: "dieroom@orrn.local", name: "Local Die Room" },
  /** ORRN platform staff (super_admin), not a tenant member. Used by Godseye tests. */
  staff: { email: "staff@orrn.local", name: "Local Staff" },
  /** KD Extrusion's party login (customer portal, Wave 3): a portal user, never a plant member. */
  party: { email: "party@orrn.local", name: "KD Extrusion (party)" },
} as const;

export type DevAccountKey = keyof typeof DEV_ACCOUNTS;

/**
 * Plant role of every plant login the seed creates (membership.role). `staff` (platform super_admin)
 * and `party` (portal) are not members, so they are not listed. Passwords: one shared local password.
 */
export const DEV_MEMBER_ROLES = {
  owner: "owner",
  operator: "operator",
  viewer: "viewer",
  office: "office",
  admin: "admin",
  manager: "manager",
  packer: "packer",
  storekeeper: "storekeeper",
  foundry: "foundry",
  accountant: "accountant",
  supervisor: "supervisor",
  press: "press",
  dieroom: "die_room",
} as const satisfies Partial<Record<DevAccountKey, string>>;

export type DevMemberKey = keyof typeof DEV_MEMBER_ROLES;
