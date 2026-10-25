/** Fixed local-dev logins. Pure constants so scripts can import them without the Workers runtime. */
export const DEV_ACCOUNTS = {
  owner: { email: "owner@orrn.local", name: "Local Owner" },
  operator: { email: "operator@orrn.local", name: "Local Operator" },
  viewer: { email: "viewer@orrn.local", name: "Local Viewer" },
  /** Plant office: raises D/C notes on scrap lots (purchase.dcnote). */
  office: { email: "office@orrn.local", name: "Local Office" },
  /** Press supervisor (press.run, press.close, press.queue): logs runs, decides nothing else (FP-PR). */
  supervisor: { email: "supervisor@orrn.local", name: "Local Supervisor" },
  /** Press man (press.run only): starts, stops and counts a run; cannot log it. */
  press: { email: "press@orrn.local", name: "Local Press" },
  /** ORRN platform staff (super_admin), not a tenant member. Used by Godseye tests. */
  staff: { email: "staff@orrn.local", name: "Local Staff" },
} as const;

export type DevAccountKey = keyof typeof DEV_ACCOUNTS;
