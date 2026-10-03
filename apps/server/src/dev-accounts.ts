/** Fixed local-dev logins. Pure constants so scripts can import them without the Workers runtime. */
export const DEV_ACCOUNTS = {
  owner: { email: "owner@orrn.local", name: "Local Owner" },
  operator: { email: "operator@orrn.local", name: "Local Operator" },
  viewer: { email: "viewer@orrn.local", name: "Local Viewer" },
  /** ORRN platform staff (super_admin), not a tenant member. Used by Godseye tests. */
  staff: { email: "staff@orrn.local", name: "Local Staff" },
} as const;

export type DevAccountKey = keyof typeof DEV_ACCOUNTS;
